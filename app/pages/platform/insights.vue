<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.insights.title')" class="mb-6">
            <template #actions>
                <SegmentedControl
                    v-model="range"
                    :items="rangeItems"
                    size="sm"
                    test-id="platform-insights-range"
                />
            </template>
        </LayoutPageHeader>

        <LayoutLoadError v-if="error" @retry="refresh()" />

        <div v-else class="flex flex-col gap-3">
            <div
                class="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6"
                data-testid="platform-insights-kpis"
            >
                <LayoutStatCard
                    v-for="kpi in kpis"
                    :key="kpi.key"
                    :title="kpi.label"
                    :value="kpi.value"
                    :previous="kpi.previous"
                    :icon="kpi.icon"
                    :color="kpi.color"
                    :format="kpi.format"
                    :subtitle="kpi.subtitle"
                    :loading="loading"
                    :data-testid="`platform-insight-${kpi.key}`"
                />
            </div>

            <div class="grid gap-3 xl:grid-cols-3">
                <AnalyticsSection
                    :title="t('platform.insights.activity.title')"
                    icon="i-lucide-activity"
                    testid="platform-insights-activity"
                    class="xl:col-span-2"
                >
                    <PlatformInsightChart
                        v-if="insights"
                        :series="insights.series"
                    />
                    <USkeleton v-else class="h-[240px] w-full" />
                </AnalyticsSection>
                <AnalyticsSection
                    :title="t('platform.insights.devices.panel')"
                    icon="i-lucide-monitor-smartphone"
                    :loading="loading"
                    :empty="!userAgentGroups.some((group) => group.rows.length)"
                    :empty-text="t('table.no_data')"
                    testid="platform-insights-devices"
                >
                    <template
                        v-for="(group, index) in userAgentGroups"
                        :key="group.key"
                    >
                        <LayoutEyebrow :class="index ? 'mt-5 mb-3' : 'mb-3'">
                            {{ group.label }}
                        </LayoutEyebrow>
                        <ul class="flex flex-col gap-3">
                            <li
                                v-for="row in group.rows"
                                :key="row.key"
                                :data-testid="`platform-${group.key}-${row.key}`"
                            >
                                <div
                                    class="mb-1 flex items-center gap-2 text-sm"
                                >
                                    <UIcon
                                        :name="row.icon"
                                        class="size-4 text-muted"
                                    />
                                    <span class="flex-1">{{ row.label }}</span>
                                    <span class="tabular-nums text-muted">
                                        {{ row.people }}
                                    </span>
                                    <span
                                        class="w-12 text-right font-medium tabular-nums"
                                    >
                                        {{ formatPercent(row.share, locale) }}
                                    </span>
                                </div>
                                <UProgress
                                    :model-value="row.share * 100"
                                    size="xs"
                                />
                            </li>
                        </ul>
                    </template>
                </AnalyticsSection>
            </div>

            <div class="grid gap-3 2xl:grid-cols-2">
                <PlatformCohortTable
                    :cohorts="insights?.cohorts ?? []"
                    :retention-weeks="insights?.retention_weeks ?? []"
                    :loading="loading"
                />
                <AnalyticsSection
                    :title="t('platform.insights.preferences.title')"
                    icon="i-lucide-user-cog"
                    :loading="loading"
                    testid="platform-insights-preferences"
                >
                    <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
                        <LayoutStatTile
                            v-for="tile in preferenceTiles"
                            :key="tile.key"
                            :label="tile.label"
                            :value="tile.value"
                            :icon="tile.icon"
                            :value-test-id="`platform-preference-${tile.key}`"
                        />
                    </div>
                    <LayoutEyebrow class="mt-4 mb-2">
                        {{ t('platform.insights.preferences.languages') }}
                    </LayoutEyebrow>
                    <LayoutListGroup>
                        <LayoutListRow
                            v-for="language in languages"
                            :key="language.code"
                            dense
                        >
                            <span class="flex-1">{{ language.label }}</span>
                            <span class="tabular-nums text-muted">
                                {{ language.value }}
                            </span>
                        </LayoutListRow>
                    </LayoutListGroup>
                    <LayoutEyebrow class="mt-4 mb-2">
                        {{ t('accountSettings.privacy.followPolicy') }}
                    </LayoutEyebrow>
                    <LayoutListGroup>
                        <LayoutListRow
                            v-for="policy in followPolicies"
                            :key="policy.code"
                            dense
                        >
                            <span class="flex-1">{{ policy.label }}</span>
                            <span class="tabular-nums text-muted">
                                {{ policy.value }}
                            </span>
                        </LayoutListRow>
                    </LayoutListGroup>
                </AnalyticsSection>
            </div>

            <PlatformGymAdoption
                :adoption="insights?.gyms ?? []"
                :gyms="gyms"
                :loading="loading"
            />

            <PlatformFeatureTable
                :features="insights?.features ?? []"
                :loading="loading"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    formatCompact,
    formatNumber,
    formatPercent,
} from '#shared/utils/number'
import { getPlatformInsights, type InsightRange } from '~/api/platform'
import { SUPPORTED_LOCALES } from '~/utils/locales'
import { insightRate } from '~/utils/platformInsights'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()
useHead({ title: () => t('platform.insights.title') })

const range = ref<InsightRange>('30d')
const rangeItems = (['30d', '90d', '12m'] as const).map((value) => ({
    value,
    label: value,
}))

const { data: gyms } = await usePlatformGyms()

const {
    data: insights,
    error,
    refresh,
} = useAsyncData('platform-insights', () => getPlatformInsights(range.value), {
    watch: [range],
    server: false,
})
const loading = computed(() => !insights.value && !error.value)

const count = (value: number) => formatNumber(value, locale.value, 0)
const percent = (value: number) => formatPercent(value, locale.value)

interface InsightKpiCard {
    key: string
    label: string
    value: number | null
    previous: number | null
    icon: string
    color: string
    format: (value: number) => string
    subtitle?: string
}

const kpis = computed<InsightKpiCard[]>(() => {
    const data = insights.value?.kpis
    const kpi = (key: string) => ({
        value: data?.[key]?.value ?? null,
        previous: data?.[key]?.previous ?? null,
    })
    const gyms = data?.gyms?.value ?? 0
    return [
        {
            key: 'active7d',
            label: t('platform.insights.kpis.active7d'),
            ...kpi('active_7d'),
            icon: 'i-lucide-user-check',
            color: 'primary',
            format: count,
        },
        {
            key: 'active30d',
            label: t('platform.insights.kpis.active30d'),
            ...kpi('active_30d'),
            icon: 'i-lucide-users-round',
            color: 'info',
            format: count,
        },
        {
            key: 'newAccounts',
            label: t('platform.insights.kpis.newAccounts'),
            ...kpi('new_accounts'),
            icon: 'i-lucide-user-plus',
            color: 'success',
            format: count,
        },
        {
            key: 'activation',
            label: t('platform.insights.kpis.activation'),
            ...kpi('activation_rate'),
            icon: 'i-lucide-rocket',
            color: 'warning',
            format: percent,
        },
        {
            key: 'activeGyms',
            label: t('platform.insights.kpis.activeGyms'),
            ...kpi('active_gyms'),
            icon: 'i-lucide-building-2',
            color: 'secondary',
            subtitle: gyms
                ? t('platform.insights.kpis.ofGyms', { n: count(gyms) })
                : undefined,
            format: count,
        },
        {
            key: 'appShare',
            label: t('platform.insights.kpis.appShare'),
            ...kpi('app_share'),
            icon: 'i-lucide-smartphone',
            color: 'neutral',
            format: percent,
        },
    ]
})

function counted(value: number | null | undefined) {
    if (value === undefined) return '—'
    return value === null
        ? t('platform.insights.fewPeople')
        : formatCompact(value, locale.value)
}

function ofAccounts(value: number | null | undefined) {
    const rate = insightRate(value, insights.value?.preferences.accounts)
    return rate === null ? counted(value) : formatPercent(rate, locale.value)
}

const preferenceTiles = computed(() => {
    const p = insights.value?.preferences
    return [
        {
            key: 'accounts',
            label: t('platform.insights.preferences.accounts'),
            value: counted(p?.accounts),
            icon: 'i-lucide-users-round',
        },
        {
            key: 'verified',
            label: t('platform.insights.preferences.verified'),
            value: ofAccounts(p?.verified),
            icon: 'i-lucide-mail-check',
        },
        {
            key: 'push',
            label: t('platform.insights.preferences.push'),
            value: ofAccounts(p?.push_enabled),
            icon: 'i-lucide-bell-ring',
        },
        {
            key: 'twoFactor',
            label: t('platform.insights.preferences.twoFactor'),
            value: ofAccounts(p?.two_factor),
            icon: 'i-lucide-shield-check',
        },
        {
            key: 'ticksPrivate',
            label: t('platform.insights.preferences.ticksPrivate'),
            value: ofAccounts(p?.ticks_private),
            icon: 'i-lucide-eye-off',
        },
        {
            key: 'leaderboardHidden',
            label: t('platform.insights.preferences.leaderboardHidden'),
            value: ofAccounts(p?.leaderboard_hidden),
            icon: 'i-lucide-trophy',
        },
        {
            key: 'reviewsAnonymous',
            label: t('platform.insights.preferences.reviewsAnonymous'),
            value: ofAccounts(p?.reviews_anonymous),
            icon: 'i-lucide-message-square-dashed',
        },
    ]
})

const USER_AGENT_ICONS: Record<string, string> = {
    phone: 'i-lucide-smartphone',
    tablet: 'i-lucide-tablet',
    desktop: 'i-lucide-monitor',
    tv: 'i-lucide-tv',
    android: 'i-simple-icons-android',
    ios: 'i-simple-icons-apple',
    macos: 'i-simple-icons-apple',
    windows: 'i-simple-icons-windows',
    linux: 'i-simple-icons-linux',
    chromeos: 'i-simple-icons-googlechrome',
}

const userAgentGroups = computed(() =>
    (
        [
            ['device', 'devices', insights.value?.devices ?? []],
            ['os', 'systems', insights.value?.systems ?? []],
        ] as const
    ).map(([key, labels, rows]) => {
        const total = rows.reduce((sum, row) => sum + row.requests, 0)
        return {
            key,
            label: t(`platform.insights.${labels}.title`),
            rows: rows.map((row) => ({
                key: row.key,
                label: t(`platform.insights.${labels}.${row.key}`),
                icon: USER_AGENT_ICONS[row.key] ?? 'i-lucide-bot',
                share: total ? row.requests / total : 0,
                people:
                    row.people_per_day === null
                        ? t('platform.insights.fewPeople')
                        : t('platform.insights.devices.perDay', {
                              n: formatNumber(row.people_per_day, locale.value),
                          }),
            })),
        }
    }),
)

const languages = computed(() =>
    Object.entries(insights.value?.preferences.languages ?? {})
        .map(([code, value]) => ({
            code,
            label:
                SUPPORTED_LOCALES.find((l) => l.code === code)?.name ??
                t('platform.insights.preferences.unset'),
            value: ofAccounts(value),
            sort: value ?? 0,
        }))
        .sort((a, b) => b.sort - a.sort),
)

const followPolicies = computed(() =>
    Object.entries(insights.value?.preferences.follow_policies ?? {}).map(
        ([code, value]) => ({
            code,
            label: t(`accountSettings.privacy.policies.${code}`),
            value: ofAccounts(value),
        }),
    ),
)
</script>
