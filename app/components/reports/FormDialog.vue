<template>
    <LayoutDialogShell
        v-model="sheetOpen"
        max-width="600"
        closable
        sheet-on-mobile
        :title="$t('reports.dialogTitle')"
        data-testid="report-form-dialog"
    >
        <p class="text-sm text-muted mb-4">
            {{ $t('reports.dialogIntro') }}
        </p>

        <UForm
            :state="form"
            :validate="(state) => validateRules(state, formRules)"
            @submit.prevent
        >
            <UFormField
                :label="$t('reports.reason')"
                name="reason"
                class="mb-4"
            >
                <USelect
                    v-model="form.reason"
                    :items="reasonItems"
                    class="w-full"
                    data-testid="report-form-reason"
                />
            </UFormField>

            <UFormField
                :label="$t('reports.explanation')"
                :help="$t('reports.explanationHint')"
                :hint="`${form.explanation.length}/2000`"
                name="explanation"
                class="mb-4"
            >
                <UTextarea
                    v-model="form.explanation"
                    :rows="3"
                    autoresize
                    class="w-full"
                    data-testid="report-form-explanation"
                />
            </UFormField>

            <div class="grid grid-cols-12 gap-4">
                <UFormField
                    :label="$t('reports.notifierName')"
                    name="notifierName"
                    class="col-span-12 sm:col-span-6"
                >
                    <UInput
                        v-model="form.notifierName"
                        class="w-full"
                        data-testid="report-form-name"
                    />
                </UFormField>
                <UFormField
                    :label="$t('reports.notifierEmail')"
                    name="notifierEmail"
                    class="col-span-12 sm:col-span-6"
                >
                    <UInput
                        v-model="form.notifierEmail"
                        type="email"
                        class="w-full"
                        data-testid="report-form-email"
                    />
                </UFormField>
            </div>

            <p class="text-xs text-muted mt-2 mb-1">
                {{ $t('reports.contactNote') }}
                <a
                    :href="privacyUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ $t('legal.privacy') }}</a
                >
            </p>

            <UFormField name="goodFaith" class="mt-3">
                <UCheckbox
                    v-model="form.goodFaith"
                    :label="$t('reports.goodFaith')"
                    data-testid="report-form-goodfaith"
                />
            </UFormField>
        </UForm>

        <template #actions>
            <UButton
                color="neutral"
                variant="ghost"
                data-testid="report-form-cancel"
                @click="close"
                >{{ $t('actions.cancel') }}</UButton
            >
            <div class="flex-1" />
            <UButton
                :disabled="!isFormValid || saving"
                color="primary"
                data-testid="report-form-submit"
                @click="submit"
            >
                <CaptchaLoader v-if="saving" />
                <template v-else>{{ $t('reports.submit') }}</template>
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import {
    required,
    nonBlank,
    maxLength,
    validEmail,
    validateRules,
} from '~/utils/validation'
import { REPORT_REASONS } from '~/utils/reports'
import type { ReportContentType } from '~/types/models'

const props = defineProps<{
    contentType: ReportContentType
    contentId: string
    contentUrl: string
    modelValue?: boolean
}>()

const emit = defineEmits<{
    'update:modelValue': [value: boolean]
    submitted: []
}>()

const pb = usePocketbase()
const { t } = useI18n()
const { notify, error: notifyError } = useNotification()
const { capHeaders } = useCapToken()

const internalOpen = ref(false)

const sheetOpen = computed({
    get() {
        return props.modelValue !== undefined
            ? props.modelValue
            : internalOpen.value
    },
    set(val: boolean) {
        if (props.modelValue !== undefined) emit('update:modelValue', val)
        else internalOpen.value = val
    },
})

const saving = ref(false)

const form = reactive({
    reason: undefined as string | undefined,
    explanation: '',
    notifierName: '',
    notifierEmail: '',
    goodFaith: false,
})

const reasonItems = computed(() =>
    REPORT_REASONS.map((value) => ({
        value: value as string,
        label: t(`reports.reasons.${value}`),
    })),
)

const { gym } = useGym()
const gymPath = useGymPath()
const privacyUrl = computed(() => gym.value?.privacy_url || gymPath('/privacy'))

const rules = {
    required: required(t),
    nonBlank: nonBlank(t),
    email: validEmail(t),
    explanationLength: maxLength(t, 2000),
    nameLength: maxLength(t, 100),
    mustAccept: (v: unknown) => v === true || t('validation.required'),
}

const formRules = {
    reason: [rules.required],
    explanation: [rules.nonBlank, rules.explanationLength],
    notifierName: [rules.nonBlank, rules.nameLength],
    notifierEmail: [rules.required, rules.email],
    goodFaith: [rules.mustAccept],
}

const isFormValid = computed(() => validateRules(form, formRules).length === 0)

function resetForm() {
    form.reason = undefined
    form.explanation = ''
    form.goodFaith = false
    const account = pb.authStore.record
    form.notifierName = (account?.name as string) || ''
    form.notifierEmail = (account?.email as string) || ''
}

watch(sheetOpen, (open) => {
    if (open) resetForm()
})

function close() {
    sheetOpen.value = false
}

async function submit() {
    saving.value = true
    try {
        await pb.collection('reports').create(
            {
                content_type: props.contentType,
                content_id: props.contentId,
                content_url: props.contentUrl,
                reason: form.reason,
                explanation: form.explanation.trim(),
                notifier_name: form.notifierName.trim(),
                notifier_email: form.notifierEmail.trim(),
                good_faith: form.goodFaith,
            },
            { headers: await capHeaders('report') },
        )

        notify(t('reports.submitted'))
        emit('submitted')
        close()
    } catch (err) {
        console.error('Failed to submit report:', err)
        notifyError(t('notifications.error.generic'))
    } finally {
        saving.value = false
    }
}
</script>
