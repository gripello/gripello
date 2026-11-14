<template>
    <AnalyticsSection
        :title="t('platform.insights.features.title')"
        icon="i-lucide-mouse-pointer-click"
        :loading="loading"
        :empty="!features.length"
        :empty-text="t('table.no_data')"
        flush
        testid="platform-features"
    >
        <div class="overflow-x-auto">
            <table class="w-full text-sm whitespace-nowrap">
                <thead>
                    <tr class="text-left text-xs text-muted">
                        <th class="px-4 py-2 font-medium">
                            {{ t('platform.insights.features.feature') }}
                        </th>
                        <th class="px-2 py-2 text-right font-medium">
                            {{ t('platform.insights.features.peoplePerDay') }}
                        </th>
                        <th
                            class="px-2 py-2 text-right font-medium max-md:hidden"
                        >
                            {{ t('platform.insights.features.requests') }}
                        </th>
                        <th
                            class="px-2 py-2 text-right font-medium max-md:hidden"
                        >
                            {{ t('platform.insights.features.signedIn') }}
                        </th>
                        <th
                            class="px-4 py-2 text-right font-medium max-md:hidden"
                        >
                            {{ t('platform.insights.features.app') }}
                        </th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-default">
                    <tr
                        v-for="feature in rows"
                        :key="feature.feature"
                        :data-testid="`platform-feature-${feature.feature}`"
                    >
                        <td class="px-4 py-2">
                            {{
                                t(`platform.insights.names.${feature.feature}`)
                            }}
                        </td>
                        <td class="px-2 py-2 text-right tabular-nums">
                            {{
                                feature.people_per_day === null
                                    ? t('platform.insights.fewPeople')
                                    : formatNumber(
                                          feature.people_per_day,
                                          locale,
                                      )
                            }}
                        </td>
                        <td
                            class="px-2 py-2 text-right whitespace-nowrap tabular-nums max-md:hidden"
                        >
                            {{ formatCompact(feature.requests, locale) }}
                            <UBadge
                                v-if="feature.trend !== null"
                                size="sm"
                                variant="soft"
                                class="ml-1"
                                :color="
                                    feature.trend >= 0 ? 'success' : 'error'
                                "
                            >
                                {{ formatTrend(feature.trend, locale) }}
                            </UBadge>
                        </td>
                        <td
                            class="px-2 py-2 text-right tabular-nums max-md:hidden"
                        >
                            {{ share(feature.signed_in_share) }}
                        </td>
                        <td
                            class="px-4 py-2 text-right tabular-nums max-md:hidden"
                        >
                            {{ share(feature.app_share) }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </AnalyticsSection>
</template>

<script setup lang="ts">
import {
    formatCompact,
    formatNumber,
    formatPercent,
} from '#shared/utils/number'
import type { PlatformInsights } from '~/api/platform'
import { formatTrend, insightTrend } from '~/utils/platformInsights'

const props = defineProps<{
    features: PlatformInsights['features']
    loading?: boolean
}>()

const { t, locale } = useI18n()

const rows = computed(() =>
    props.features.map((feature) => ({
        ...feature,
        trend: insightTrend(feature.requests, feature.previous_requests),
    })),
)

function share(value: number | null) {
    return value === null ? '—' : formatPercent(value, locale.value)
}
</script>
