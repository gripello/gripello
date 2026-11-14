<template>
    <AnalyticsSection
        :title="t('platform.insights.gyms.title')"
        icon="i-lucide-building-2"
        :loading="loading"
        :empty="!rows.length"
        empty-icon="i-lucide-building-2"
        :empty-text="t('table.no_data')"
        flush
        testid="platform-gym-adoption"
    >
        <template #actions>
            <SegmentedControl
                v-model="sort"
                :items="sortItems"
                size="xs"
                test-id="platform-gym-adoption-sort"
            />
        </template>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead>
                    <tr class="text-left text-xs whitespace-nowrap text-muted">
                        <th class="px-4 py-2 font-medium">
                            {{ t('platform.insights.gyms.gym') }}
                        </th>
                        <th class="px-2 py-2 text-right font-medium">
                            {{ t('platform.insights.gyms.logs') }}
                        </th>
                        <th
                            class="px-2 py-2 text-right font-medium max-md:hidden"
                        >
                            {{ t('platform.insights.gyms.climbers') }}
                        </th>
                        <th
                            class="px-2 py-2 text-right font-medium max-lg:hidden"
                        >
                            {{ t('platform.insights.gyms.reviews') }}
                        </th>
                        <th
                            class="px-2 py-2 text-right font-medium max-lg:hidden"
                        >
                            {{ t('platform.insights.gyms.routesSet') }}
                        </th>
                        <th class="px-2 py-2 font-medium max-xl:hidden">
                            {{ t('platform.insights.gyms.lastRouteSet') }}
                        </th>
                        <th class="px-4 py-2 font-medium max-md:hidden">
                            {{ t('platform.insights.gyms.tools') }}
                        </th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-default">
                    <tr
                        v-for="row in rows"
                        :key="row.gym"
                        :data-testid="`platform-gym-adoption-${row.gym}`"
                    >
                        <td class="px-4 py-2 max-md:max-w-[60vw]">
                            <NuxtLink
                                :to="`/platform/gyms/${row.gym}`"
                                class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                            >
                                <PlatformGymIdentity
                                    v-if="row.record"
                                    :gym="row.record"
                                    class="min-w-0 flex-1"
                                />
                                <span v-else class="flex-1 font-mono text-xs">
                                    {{ row.gym }}
                                </span>
                                <UBadge
                                    v-if="row.quiet"
                                    color="warning"
                                    variant="soft"
                                    size="sm"
                                    icon="i-lucide-trending-down"
                                    :aria-label="
                                        t('platform.insights.gyms.quiet')
                                    "
                                    :data-testid="`platform-gym-quiet-${row.gym}`"
                                >
                                    <span class="max-md:hidden">
                                        {{ t('platform.insights.gyms.quiet') }}
                                    </span>
                                </UBadge>
                            </NuxtLink>
                        </td>
                        <td
                            class="px-2 py-2 text-right whitespace-nowrap tabular-nums"
                        >
                            {{ formatCompact(row.logs, locale) }}
                            <UBadge
                                v-if="row.trend !== null"
                                size="sm"
                                variant="soft"
                                class="ml-1"
                                :color="row.trend >= 0 ? 'success' : 'error'"
                            >
                                {{ formatTrend(row.trend, locale) }}
                            </UBadge>
                        </td>
                        <td
                            class="px-2 py-2 text-right tabular-nums max-md:hidden"
                        >
                            {{
                                row.climbers === null
                                    ? t('platform.insights.fewPeople')
                                    : row.climbers
                            }}
                        </td>
                        <td
                            class="px-2 py-2 text-right tabular-nums max-lg:hidden"
                        >
                            {{ row.reviews }}
                        </td>
                        <td
                            class="px-2 py-2 text-right tabular-nums max-lg:hidden"
                        >
                            {{ row.routes_set }}
                        </td>
                        <td class="px-2 py-2 whitespace-nowrap max-xl:hidden">
                            {{
                                formatDate(row.last_route_set_at, {
                                    locale,
                                    fallback: '—',
                                })
                            }}
                        </td>
                        <td class="px-4 py-2 max-md:hidden">
                            <div class="flex flex-wrap gap-1">
                                <UBadge
                                    v-for="feature in row.features"
                                    :key="feature"
                                    color="neutral"
                                    variant="subtle"
                                    size="sm"
                                >
                                    {{
                                        t(
                                            `platform.insights.gyms.features.${feature}`,
                                        )
                                    }}
                                </UBadge>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </AnalyticsSection>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import { formatCompact } from '#shared/utils/number'
import type { PlatformInsights } from '~/api/platform'
import type { PlatformGym } from '~/utils/platformGyms'
import {
    formatTrend,
    gymGoingQuiet,
    insightTrend,
    sortInsightGyms,
    type InsightGymSort,
} from '~/utils/platformInsights'

const props = defineProps<{
    adoption: PlatformInsights['gyms']
    gyms: PlatformGym[]
    loading?: boolean
}>()

const { t, locale } = useI18n()

const sort = ref<InsightGymSort>('logs')
const sortItems = computed(() => [
    { value: 'logs' as const, label: t('platform.insights.gyms.sortLogs') },
    { value: 'drop' as const, label: t('platform.insights.gyms.sortDrop') },
])

const rows = computed(() =>
    sortInsightGyms(props.adoption, sort.value).map((row) => ({
        ...row,
        record: props.gyms.find((gym) => gym.id === row.gym),
        trend: insightTrend(row.logs, row.previous_logs),
        quiet: gymGoingQuiet(row.logs, row.previous_logs),
    })),
)
</script>
