<template>
    <LayoutDialogShell
        v-model="open"
        max-width="480"
        closable
        sheet-on-mobile
        :title="tick ? $t('ticks.edit') : $t('ticks.logAscent')"
        data-testid="tick-dialog"
    >
        <UForm
            ref="formRef"
            :state="form"
            :validate="
                (state) =>
                    validateRules(state, {
                        attempts: [attemptsRule],
                        day: [required(t)],
                    })
            "
            @submit="submit"
        >
            <div class="flex gap-2 mb-5" role="radiogroup">
                <UButton
                    v-for="type in TICK_TYPES"
                    :key="type"
                    role="radio"
                    :aria-checked="form.type === type"
                    :color="form.type === type ? 'primary' : 'neutral'"
                    :variant="form.type === type ? 'solid' : 'soft'"
                    :icon="TICK_TYPE_ICONS[type]"
                    class="tick-dialog__type h-12 justify-center"
                    :data-testid="`tick-type-${type}`"
                    @click="form.type = type"
                >
                    {{ $t(`ticks.types.${type}`) }}
                </UButton>
            </div>

            <div class="grid grid-cols-12 gap-3 mb-4">
                <UFormField
                    name="attempts"
                    :label="$t('ticks.attempts')"
                    class="col-span-12 sm:col-span-6"
                >
                    <UInputNumber
                        v-model="form.attempts"
                        :min="1"
                        :max="999"
                        :disabled="form.type === 'flash'"
                        class="w-full"
                        data-testid="tick-attempts"
                    />
                </UFormField>
                <UFormField
                    name="day"
                    :label="$t('ticks.date')"
                    class="col-span-12 sm:col-span-6"
                >
                    <UInput
                        v-model="form.day"
                        type="date"
                        :max="today"
                        class="w-full"
                        data-testid="tick-date"
                    />
                </UFormField>
            </div>

            <UFormField
                name="note"
                :label="$t('ticks.note')"
                :help="$t('ticks.noteHint')"
                :hint="`${form.note.length}/500`"
            >
                <UTextarea
                    v-model="form.note"
                    :maxlength="500"
                    :rows="2"
                    autoresize
                    class="w-full"
                    data-testid="tick-note"
                />
            </UFormField>
        </UForm>

        <template #actions>
            <UButton color="neutral" variant="ghost" @click="open = false">
                {{ $t('actions.cancel') }}
            </UButton>
            <div class="flex-1" />
            <UButton
                color="primary"
                :loading="saving"
                data-testid="tick-submit"
                @click="submit"
            >
                {{ $t('actions.save') }}
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import type { Form } from '@nuxt/ui'
import type { TickRecord } from '~/types/models'
import { required, validateRules } from '~/utils/validation'
import {
    TICK_TYPES,
    tickDate,
    tickDay,
    type TickType,
} from '#shared/utils/ticks'
import { localDay } from '#shared/utils/ticks'
import { TICK_TYPE_ICONS } from '~/utils/ticks'

const open = defineModel<boolean>({ default: false })

const props = withDefaults(
    defineProps<{
        routeId?: string | null
        tick?: TickRecord | null
    }>(),
    { routeId: null, tick: null },
)

const emit = defineEmits<{ saved: [tick: TickRecord] }>()

const authStore = useAuthStore()
const { t } = useI18n()
const { notify, error: notifyError } = useNotification()
const { createTick, updateTick } = useTickOutbox()

const saving = ref(false)
const today = ref(localToday())

const form = reactive({
    type: 'top' as TickType,
    attempts: 1,
    day: today.value,
    note: '',
})

const formRef = useTemplateRef<Form<typeof form>>('formRef')

const attemptsRule = (value: unknown) =>
    (Number.isInteger(value) &&
        (value as number) >= 1 &&
        (value as number) <= 999) ||
    t('ticks.attemptsInvalid')

function localToday() {
    return localDay(new Date())
}

watch(open, (isOpen) => {
    if (!isOpen) return
    today.value = localToday()
    form.type = props.tick?.type ?? 'top'
    form.attempts = props.tick?.attempts ?? 1
    form.day = props.tick ? tickDay(props.tick.date) : today.value
    form.note = props.tick?.note ?? ''
})

watch(
    () => form.type,
    (type) => {
        if (type === 'flash') form.attempts = 1
    },
)

async function submit() {
    const valid =
        !!formRef.value &&
        (await formRef.value.validate({ silent: true })) !== false
    if (!valid || saving.value) return
    saving.value = true
    const fields = {
        type: form.type,
        attempts: form.attempts,
        date: tickDate(form.day),
        note: form.note.trim(),
    }
    try {
        const { tick: saved, queued } = props.tick
            ? await updateTick(props.tick, fields)
            : await createTick({
                  ...fields,
                  user: authStore.record?.id ?? '',
                  route: props.routeId,
              })
        notify(t(queued ? 'ticks.savedOffline' : 'ticks.saved'))
        emit('saved', saved)
        open.value = false
    } catch (err) {
        console.error('Saving tick failed:', err)
        notifyError(t('ticks.saveError'))
    } finally {
        saving.value = false
    }
}
</script>

<style scoped>
.tick-dialog__type {
    flex: 1 1 0;
    min-width: 0;
}
</style>
