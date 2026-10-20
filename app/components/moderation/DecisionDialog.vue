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
                <OptionGrid
                    v-model="preset"
                    :items="reasons"
                    cols="grid-cols-1 sm:grid-cols-2"
                    deselectable
                    :label="t('moderation.decision.why')"
                    test-id-prefix="moderation-reason"
                />
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
import { translatedItems } from '~/utils/translatedItems'
import { REPORT_REASONS } from '#shared/utils/reports'
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

const preset = ref<string | null>(null)
const explanation = ref('')
const reasons = computed(() =>
    translatedItems(
        REPORT_REASONS.filter((value) => value !== 'other'),
        'reports.reasons',
        t,
    ),
)
const reason = computed(() =>
    decisionReason(
        preset.value ? t(`reports.reasons.${preset.value}`) : '',
        explanation.value,
    ),
)

watch(open, (isOpen) => {
    if (!isOpen) return
    preset.value = null
    explanation.value = ''
})
</script>
