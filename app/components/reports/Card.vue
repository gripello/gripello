<template>
    <article
        class="rounded-lg border border-default bg-default"
        :data-testid="`report-card-${report.id}`"
    >
        <header class="flex flex-wrap items-start gap-x-3 gap-y-2 p-4 pb-3">
            <span
                class="flex size-9 shrink-0 items-center justify-center rounded-full"
                :class="statusIconClass[statusColor(report.status)]"
            >
                <UIcon name="i-lucide-flag" class="size-[18px]" />
            </span>
            <div class="min-w-0 grow">
                <h3 class="text-sm font-semibold text-highlighted">
                    {{ t(`reports.reasons.${report.reason}`) }}
                </h3>
                <time
                    class="text-xs text-muted"
                    :datetime="report.created"
                    :title="
                        formatDate(report.created, { locale, withTime: true })
                    "
                >
                    {{ timeAgo(report.created, t, locale) }}
                </time>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
                <UBadge
                    v-if="!report.receipt_sent"
                    color="warning"
                    variant="soft"
                    data-testid="report-card-receipt-pending"
                >
                    {{ t('reports.receiptPending') }}
                </UBadge>
                <UBadge
                    v-if="report.status !== 'open' && report.decision"
                    color="neutral"
                    variant="soft"
                >
                    {{ t(`reports.decision.${report.decision}`) }}
                </UBadge>
                <UBadge
                    :color="statusColor(report.status)"
                    variant="soft"
                    data-testid="report-card-status"
                >
                    {{ t(`reports.status.${report.status}`) }}
                </UBadge>
            </div>
        </header>

        <div class="flex flex-col gap-3 px-4 pb-4">
            <p v-if="report.explanation" class="text-sm whitespace-pre-line">
                {{ report.explanation }}
            </p>
            <blockquote
                class="rounded-md border-s-2 border-accented bg-muted px-3 py-2 text-sm italic"
                :aria-label="t('reports.snapshot')"
            >
                {{ report.content_snapshot || t('reports.contentUnavailable') }}
            </blockquote>
            <dl
                class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs"
            >
                <dt class="text-muted">{{ t('reports.notifier') }}</dt>
                <dd class="flex min-w-0 items-center gap-2">
                    <UAvatar :alt="report.notifier_name" size="2xs" />
                    <span class="truncate">
                        {{ report.notifier_name }}
                        <span class="text-muted">{{
                            report.notifier_email
                        }}</span>
                    </span>
                </dd>
                <template v-if="report.decision_reason">
                    <dt class="text-muted">
                        {{ t('reports.decisionReason') }}
                    </dt>
                    <dd>{{ report.decision_reason }}</dd>
                </template>
            </dl>
        </div>

        <footer
            class="flex flex-wrap items-center gap-2 border-t border-default px-4 py-2"
        >
            <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                :href="appContentUrl(report.content_url)"
                target="_blank"
                rel="noopener noreferrer"
                icon="i-lucide-external-link"
                class="-ms-2"
                data-testid="report-card-view"
            >
                {{ t('reports.viewContent') }}
            </UButton>
            <template v-if="report.status === 'open'">
                <div class="flex-1" />
                <UButton
                    color="neutral"
                    variant="outline"
                    size="sm"
                    data-testid="report-card-keep"
                    @click="$emit('decide', report, 'content_kept')"
                >
                    {{ t('reports.keepContent') }}
                </UButton>
                <UButton
                    v-if="canRemove"
                    size="sm"
                    color="error"
                    data-testid="report-card-remove"
                    @click="$emit('decide', report, 'content_removed')"
                >
                    {{ t('reports.removeContent') }}
                </UButton>
            </template>
        </footer>
    </article>
</template>

<script setup lang="ts">
import { statusColor } from '~/utils/reports'
import { formatDate, timeAgo } from '#shared/utils/formatting'
import type { ReportDecision, ReportRecord } from '~/types/models'

defineProps<{ report: ReportRecord; canRemove: boolean }>()

defineEmits<{ decide: [report: ReportRecord, decision: ReportDecision] }>()

const { t, locale } = useI18n()

const statusIconClass = {
    warning: 'bg-warning/10 text-warning',
    success: 'bg-success/10 text-success',
    neutral: 'bg-elevated text-muted',
}

const appContentUrl = (url: string) =>
    /^\/route\?id=\w+(#comment-\w+)?$/.test(url) ? url : undefined
</script>
