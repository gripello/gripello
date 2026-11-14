<template>
    <AnalyticsSection
        :title="t('platform.insights.cohorts.title')"
        icon="i-lucide-users-round"
        :loading="loading"
        :empty="!cohorts.length"
        :empty-text="t('table.no_data')"
        flush
        testid="platform-cohorts"
    >
        <div class="overflow-x-auto">
            <table class="w-full text-sm whitespace-nowrap">
                <thead>
                    <tr class="text-left text-xs text-muted">
                        <th class="px-4 py-2 font-medium">
                            {{ t('platform.insights.cohorts.month') }}
                        </th>
                        <th class="px-2 py-2 text-right font-medium">
                            {{ t('platform.insights.cohorts.accounts') }}
                        </th>
                        <th
                            v-for="column in columns"
                            :key="column.key"
                            class="px-2 py-2 text-right font-medium last:pr-4"
                        >
                            {{ column.label }}
                        </th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-default">
                    <tr
                        v-for="cohort in rows"
                        :key="cohort.month"
                        :data-testid="`platform-cohort-${cohort.month}`"
                    >
                        <td class="px-4 py-2">
                            {{ formatMonthLabel(cohort.month, locale) }}
                        </td>
                        <td class="px-2 py-2 text-right tabular-nums">
                            {{
                                cohort.accounts === null
                                    ? t('platform.insights.fewPeople')
                                    : cohort.accounts
                            }}
                        </td>
                        <td
                            v-for="cell in cohort.cells"
                            :key="cell.key"
                            class="px-2 py-2 text-right tabular-nums last:pr-4"
                            :class="cell.rate === null && 'text-muted'"
                            :style="
                                cell.rate === null
                                    ? undefined
                                    : {
                                          background: `color-mix(in oklab, var(--ui-primary) ${Math.round(cell.rate * 35)}%, transparent)`,
                                      }
                            "
                        >
                            {{
                                cell.rate === null
                                    ? '—'
                                    : formatPercent(cell.rate, locale)
                            }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </AnalyticsSection>
</template>

<script setup lang="ts">
import { formatPercent } from '#shared/utils/number'
import type { PlatformInsights } from '~/api/platform'
import { formatMonthLabel } from '~/utils/echarts'
import { insightRate } from '~/utils/platformInsights'

const props = defineProps<{
    cohorts: PlatformInsights['cohorts']
    retentionWeeks: number[]
    loading?: boolean
}>()

const { t, locale } = useI18n()

const columns = computed(() => [
    { key: 'verified', label: t('platform.insights.cohorts.verified') },
    { key: 'firstLog', label: t('platform.insights.cohorts.firstLog') },
    ...props.retentionWeeks.map((weeks) => ({
        key: `back${weeks}`,
        label: t('platform.insights.cohorts.back', { n: weeks }),
    })),
])

const rows = computed(() =>
    [...props.cohorts].reverse().map((cohort) => ({
        month: cohort.month,
        accounts: cohort.accounts,
        cells: [cohort.verified, cohort.first_log, ...cohort.back].map(
            (count, i) => ({
                key: columns.value[i]?.key ?? String(i),
                rate: insightRate(count, cohort.accounts),
            }),
        ),
    })),
)
</script>
