<template>
    <button
        type="button"
        class="flex w-full gap-3 rounded-2xl border bg-default p-4 text-start transition-colors"
        :class="
            selected
                ? 'border-primary ring-1 ring-primary'
                : 'border-default hover:border-accented'
        "
        :aria-pressed="selected"
        :data-testid="`moderation-case-${item.id}`"
        @click="emit('select')"
    >
        <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full"
            :class="ICON_TONES[tone]"
        >
            <UIcon :name="icon" class="size-[18px]" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="flex items-center gap-2">
                <span class="truncate text-sm font-semibold text-highlighted">
                    {{ heading }}
                </span>
                <UBadge
                    v-if="openReports"
                    :color="tone === 'error' ? 'error' : 'warning'"
                    variant="soft"
                    size="sm"
                    class="shrink-0 whitespace-nowrap"
                >
                    {{ t('moderation.reports', openReports) }}
                </UBadge>
                <span
                    v-if="isNew"
                    class="size-2 shrink-0 rounded-full bg-primary"
                    aria-hidden="true"
                />
                <span v-if="isNew" class="sr-only">{{
                    t('moderation.new')
                }}</span>
                <time
                    class="ms-auto shrink-0 text-xs text-muted"
                    :datetime="item.created"
                >
                    {{ timeAgo(item.created, t, locale) }}
                </time>
            </span>
            <span
                v-if="text"
                class="truncate text-sm italic"
                data-testid="moderation-case-text"
            >
                {{ text }}
            </span>
            <span class="truncate text-xs text-muted">{{ meta }}</span>
        </span>
    </button>
</template>

<script setup lang="ts">
import type { ModerationItemRecord } from '~/types/models'
import {
    CONTENT_ICONS,
    moderationText,
    openReportCount,
} from '~/utils/moderation'
import { timeAgo } from '#shared/utils/formatting'

const props = defineProps<{
    item: ModerationItemRecord
    selected: boolean
    isNew: boolean
    platform?: boolean
}>()
const emit = defineEmits<{ select: [] }>()

const { t, locale } = useI18n()

const LEGAL_REASONS = [
    'hate_speech',
    'violence_threat',
    'sexual_content',
    'personal_data',
]
const ICON_TONES = {
    error: 'bg-error/10 text-error',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
    neutral: 'bg-muted text-primary',
}

const reports = computed(() => props.item.context?.reports ?? [])
const openReports = computed(() => openReportCount(reports.value))
const firstOpen = computed(() =>
    reports.value.find((report) => report.status === 'open'),
)
const tone = computed<keyof typeof ICON_TONES>(() => {
    if (firstOpen.value)
        return LEGAL_REASONS.includes(firstOpen.value.reason)
            ? 'error'
            : 'warning'
    return props.item.state === 'pending' ? 'info' : 'neutral'
})
const icon = computed(() =>
    firstOpen.value ? 'i-lucide-flag' : CONTENT_ICONS[props.item.content_type],
)
const heading = computed(() => {
    if (firstOpen.value) return t(`reports.reasons.${firstOpen.value.reason}`)
    if (props.item.state === 'pending') return t('moderation.waitingTitle')
    return t(`moderation.types.${props.item.content_type}`)
})
const text = computed(() => moderationText(props.item))
const meta = computed(() =>
    [
        t(`moderation.types.${props.item.content_type}`),
        props.item.context?.author?.name,
        props.item.context?.route?.name ?? props.item.context?.competition,
        props.platform ? props.item.context?.gym_name : '',
    ]
        .filter(Boolean)
        .join(' · '),
)
</script>
