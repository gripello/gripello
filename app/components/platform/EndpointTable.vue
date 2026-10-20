<template>
    <AnalyticsSection
        :title="t('platform.overview.traffic.endpoints')"
        icon="i-lucide-route"
        :loading="loading"
        :empty="!endpoints.length"
        empty-icon="i-lucide-route"
        :empty-text="t('table.no_data')"
        flush
        testid="platform-endpoints"
    >
        <template #actions>
            <SegmentedControl
                v-model="sort"
                :items="sortItems"
                size="xs"
                test-id="platform-endpoints-sort"
            />
        </template>
        <div class="overflow-x-auto">
            <table class="w-full text-sm whitespace-nowrap md:min-w-[640px]">
                <thead>
                    <tr class="text-left text-xs text-muted">
                        <th class="px-4 py-2 font-medium">
                            {{ t('platform.overview.traffic.endpoint') }}
                        </th>
                        <th class="px-2 py-2 text-right font-medium">
                            {{ t('platform.overview.traffic.requests') }}
                        </th>
                        <th class="px-2 py-2 font-medium md:w-48">
                            <span class="max-md:hidden">
                                {{
                                    t(
                                        'platform.overview.traffic.serverErrorRate',
                                    )
                                }}
                            </span>
                            <span class="md:hidden">5xx</span>
                        </th>
                        <th
                            class="px-2 py-2 text-right font-medium max-md:hidden"
                        >
                            4xx
                        </th>
                        <th
                            class="px-4 py-2 text-right font-medium max-md:hidden"
                        >
                            p95
                        </th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-default">
                    <tr
                        v-for="endpoint in rows"
                        :key="`${endpoint.method} ${endpoint.pattern}`"
                        :data-testid="`platform-endpoint-${endpoint.method}-${endpoint.pattern}`"
                    >
                        <td class="px-4 py-2 font-mono text-xs max-md:pr-2">
                            <span
                                class="flex items-center gap-1 max-md:max-w-[50vw]"
                            >
                                <UBadge
                                    v-if="endpoint.method"
                                    :color="
                                        endpoint.method === 'GET'
                                            ? 'info'
                                            : 'secondary'
                                    "
                                    variant="subtle"
                                    size="sm"
                                    class="shrink-0"
                                >
                                    {{ endpoint.method }}
                                </UBadge>
                                <span
                                    class="min-w-0 truncate"
                                    :title="endpoint.pattern"
                                >
                                    {{ endpoint.pattern }}
                                </span>
                            </span>
                        </td>
                        <td class="px-2 py-2 text-right tabular-nums">
                            {{ formatCompact(endpoint.requests, locale) }}
                        </td>
                        <td class="px-2 py-2">
                            <div class="flex items-center gap-2">
                                <UProgress
                                    :model-value="
                                        Math.min(
                                            100,
                                            errorRate(endpoint) * 2000,
                                        )
                                    "
                                    :color="errorRateColor(errorRate(endpoint))"
                                    size="sm"
                                    class="flex-1 max-md:hidden"
                                />
                                <span
                                    class="w-14 text-right tabular-nums"
                                    :class="{
                                        'font-semibold text-error':
                                            errorRate(endpoint) >= 0.05,
                                    }"
                                >
                                    {{
                                        formatPercent(
                                            errorRate(endpoint),
                                            locale,
                                        )
                                    }}
                                </span>
                            </div>
                        </td>
                        <td
                            class="px-2 py-2 text-right tabular-nums text-muted max-md:hidden"
                        >
                            {{
                                formatPercent(clientErrorRate(endpoint), locale)
                            }}
                        </td>
                        <td
                            class="px-4 py-2 text-right tabular-nums max-md:hidden"
                        >
                            {{
                                endpoint.p95_ms
                                    ? formatMs(endpoint.p95_ms, locale)
                                    : '—'
                            }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div
            v-if="sorted.length > 8"
            class="border-t border-default px-4 py-2 text-center"
        >
            <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                :trailing-icon="
                    showAll ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'
                "
                data-testid="platform-endpoints-more"
                @click="showAll = !showAll"
            >
                {{
                    showAll
                        ? t('platform.overview.traffic.showLess')
                        : t('platform.overview.traffic.showAll', sorted.length)
                }}
            </UButton>
        </div>
    </AnalyticsSection>
</template>

<script setup lang="ts">
import { formatCompact, formatPercent } from '#shared/utils/number'
import type { TrafficEndpoint } from '~/api/platform'
import {
    clientErrorRate,
    errorRate,
    errorRateColor,
    formatMs,
    sortEndpoints,
    type EndpointSort,
} from '~/utils/platformTraffic'

const props = defineProps<{
    endpoints: TrafficEndpoint[]
    loading?: boolean
}>()

const { t, locale } = useI18n()

const sort = ref<EndpointSort>('errors')
const sortItems = computed(() => [
    {
        value: 'errors' as const,
        label: t('platform.overview.traffic.sortErrors'),
    },
    {
        value: 'requests' as const,
        label: t('platform.overview.traffic.requests'),
    },
    {
        value: 'slowest' as const,
        label: t('platform.overview.traffic.sortSlowest'),
    },
])
const showAll = ref(false)
const sorted = computed(() => sortEndpoints(props.endpoints, sort.value))
const rows = computed(() => sorted.value.slice(0, showAll.value ? 100 : 8))
</script>
