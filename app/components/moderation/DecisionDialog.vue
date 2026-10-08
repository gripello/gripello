<template>
    <LayoutDialogShell
        v-model="open"
        closable
        sheet-on-mobile
        :title="title"
        :subtitle="subject"
        data-testid="moderation-decision-dialog"
    >
        <div class="flex flex-col gap-4">
            <fieldset class="flex flex-col gap-2">
                <legend class="mb-2 text-sm font-semibold text-highlighted">
                    {{ t('moderation.decision.why') }}
                </legend>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        v-for="reason in reasons"
                        :key="reason.value"
                        size="sm"
                        :color="preset === reason.value ? 'primary' : 'neutral'"
                        :variant="preset === reason.value ? 'soft' : 'outline'"
                        :aria-pressed="preset === reason.value"
                        :data-testid="`moderation-reason-${reason.value}`"
                        @click="
                            preset = preset === reason.value ? '' : reason.value
                        "
                    >
                        {{ reason.label }}
                    </UButton>
                </div>
            </fieldset>
            <UFormField
                :label="t('moderation.decision.explanation')"
                :hint="`${explanation.length}/1500`"
            >
                <UTextarea
                    v-model="explanation"
                    :rows="3"
                    :maxlength="1500"
                    autoresize
                    class="w-full"
                    data-testid="moderation-reason"
                />
            </UFormField>
            <section
                v-if="consequences.length"
                class="rounded-xl bg-muted px-4 py-3"
            >
                <h3 class="mb-1 text-sm font-semibold text-highlighted">
                    {{ t('moderation.decision.whatHappens') }}
                </h3>
                <ul class="list-disc ps-5 text-sm leading-relaxed">
                    <li v-for="line in consequences" :key="line">
                        {{ line }}
                    </li>
                </ul>
            </section>
        </div>
        <template #actions>
            <UButton color="neutral" variant="ghost" @click="open = false">
                {{ t('actions.cancel') }}
            </UButton>
            <div class="flex-1" />
            <UButton
                color="error"
                :disabled="!reason"
                :loading="loading"
                data-testid="moderation-decision-confirm"
                @click="emit('confirm', reason)"
            >
                {{ confirmLabel }}
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { REPORT_REASONS } from '~/utils/reports'
import { decisionReason } from '~/utils/moderation'

const open = defineModel<boolean>({ default: false })
defineProps<{
    title: string
    subject?: string
    confirmLabel: string
    consequences: string[]
    loading?: boolean
}>()
const emit = defineEmits<{ confirm: [reason: string] }>()

const { t } = useI18n()

const preset = ref('')
const explanation = ref('')
const reasons = computed(() =>
    REPORT_REASONS.filter((value) => value !== 'other').map((value) => ({
        value,
        label: t(`reports.reasons.${value}`),
    })),
)
const reason = computed(() =>
    decisionReason(
        preset.value ? t(`reports.reasons.${preset.value}`) : '',
        explanation.value,
    ),
)

watch(open, (isOpen) => {
    if (!isOpen) return
    preset.value = ''
    explanation.value = ''
})
</script>
