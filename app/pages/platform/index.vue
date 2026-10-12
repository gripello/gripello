<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.overview.title')" class="mb-6">
            <template #actions>
                <UBadge
                    v-if="traffic"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-server"
                    data-testid="platform-overview-version"
                >
                    {{ traffic.system.version }}
                </UBadge>
            </template>
        </LayoutPageHeader>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    @click="retry"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <div v-else class="flex flex-col gap-3">
            <div
                class="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6"
                data-testid="platform-traffic-kpis"
            >
                <AnalyticsStatsCard
                    v-for="kpi in kpis"
                    :key="kpi.key"
                    :title="kpi.label"
                    :value="kpi.value"
                    :previous="kpi.previous"
                    :icon="kpi.icon"
                    :color="kpi.color"
                    :format="kpi.format"
                    :spark="kpi.spark"
                    :loading="trafficPending && !traffic"
                    :data-testid="`platform-kpi-${kpi.key}`"
                />
            </div>

            <div class="grid-cols-12 gap-3 max-xl:contents xl:grid">
                <div class="col-span-8 flex-col gap-3 max-xl:contents xl:flex">
                    <AnalyticsSection
                        :title="t('platform.overview.traffic.title')"
                        icon="i-lucide-activity"
                        :loading="trafficPending && !traffic"
                        :empty="!!trafficError"
                        :empty-text="t('errors.loadFailed')"
                        testid="platform-traffic"
                    >
                        <template #actions>
                            <SegmentedControl
                                v-model="range"
                                :items="rangeItems"
                                size="sm"
                                test-id="platform-traffic-range"
                            />
                        </template>
                        <PlatformTrafficChart
                            v-if="traffic"
                            :series="traffic.series"
                            :step-seconds="traffic.step_seconds"
                        />
                    </AnalyticsSection>
                    <PlatformEndpointTable
                        :endpoints="traffic?.endpoints ?? []"
                    />
                    <AnalyticsSection
                        :title="t('platform.gyms.title')"
                        icon="i-lucide-building-2"
                        :empty="!gyms.length"
                        empty-icon="i-lucide-building-2"
                        :empty-text="t('table.no_data')"
                        flush
                        testid="platform-gyms"
                        class="max-lg:hidden"
                    >
                        <template #actions>
                            <UButton
                                to="/platform/gyms"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                trailing-icon="i-lucide-arrow-right"
                                data-testid="platform-gyms-manage"
                            >
                                {{ t('nav.manageGyms') }}
                            </UButton>
                        </template>
                        <ul class="divide-y divide-default">
                            <li
                                v-for="gym in gyms"
                                :key="gym.id"
                                class="flex items-center gap-3 px-4 py-3"
                                :data-testid="`platform-overview-gym-${gym.slug}`"
                            >
                                <NuxtLink
                                    :to="`/platform/gyms/${gym.id}`"
                                    class="min-w-0 flex-1"
                                >
                                    <PlatformGymIdentity :gym="gym" />
                                </NuxtLink>
                                <UButton
                                    v-if="openCases(gym.id)"
                                    :to="`/platform/moderation?gym=${gym.id}`"
                                    color="error"
                                    variant="soft"
                                    size="sm"
                                    icon="i-lucide-shield-alert"
                                    :data-testid="`platform-gym-open-cases-${gym.slug}`"
                                >
                                    {{
                                        t(
                                            'moderation.openCases',
                                            openCases(gym.id),
                                        )
                                    }}
                                </UButton>
                                <div
                                    class="hidden shrink-0 items-center gap-4 text-sm text-muted sm:flex"
                                >
                                    <span
                                        v-for="count in gymCounts(gym)"
                                        :key="count.key"
                                        class="flex w-14 items-center justify-end gap-1 tabular-nums"
                                        :data-testid="`platform-gym-${count.key}-${gym.slug}`"
                                    >
                                        <UIcon
                                            :name="count.icon"
                                            class="size-4"
                                        />
                                        {{ count.value }}
                                        <span class="sr-only">
                                            {{ count.label }}
                                        </span>
                                    </span>
                                </div>
                                <div class="flex shrink-0 items-center">
                                    <UButton
                                        v-if="gym.active"
                                        :to="`/${gym.slug}`"
                                        icon="i-lucide-external-link"
                                        color="neutral"
                                        variant="ghost"
                                        class="icon-btn"
                                        :aria-label="t('platform.gyms.open')"
                                        :data-testid="`platform-gym-open-${gym.slug}`"
                                    />
                                    <UButton
                                        :to="`/platform/gyms/${gym.id}`"
                                        icon="i-lucide-pencil"
                                        color="neutral"
                                        variant="ghost"
                                        class="icon-btn"
                                        :aria-label="t('actions.edit')"
                                        :data-testid="`platform-gym-edit-${gym.slug}`"
                                    />
                                </div>
                            </li>
                        </ul>
                    </AnalyticsSection>
                </div>
                <div class="col-span-4 flex-col gap-3 max-xl:contents xl:flex">
                    <AnalyticsSection
                        :title="t('platform.overview.needsYou')"
                        icon="i-lucide-bell-ring"
                        color="error"
                        flush
                        testid="platform-needs-you"
                        class="max-xl:-order-1"
                    >
                        <ul class="divide-y divide-default">
                            <li v-for="tile in attentionTiles" :key="tile.key">
                                <NuxtLink
                                    :to="tile.to"
                                    class="flex min-h-11 items-center gap-3 px-4 py-2 text-sm hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-primary"
                                    :data-testid="`platform-attention-${tile.key}`"
                                >
                                    <UIcon
                                        :name="tile.icon"
                                        class="size-4 shrink-0"
                                        :class="
                                            tile.value
                                                ? ATTENTION_COLORS[tile.color]
                                                : 'text-dimmed'
                                        "
                                    />
                                    <span
                                        class="flex-1"
                                        :class="
                                            tile.value
                                                ? 'text-highlighted'
                                                : 'text-muted'
                                        "
                                    >
                                        {{ tile.label }}
                                    </span>
                                    <span
                                        class="font-bold tabular-nums"
                                        :class="
                                            tile.value
                                                ? 'text-highlighted'
                                                : 'text-dimmed'
                                        "
                                    >
                                        {{ tile.value }}
                                    </span>
                                </NuxtLink>
                            </li>
                        </ul>
                    </AnalyticsSection>
                    <AnalyticsSection
                        :title="t('platform.overview.people.title')"
                        icon="i-lucide-users-round"
                        color="info"
                        testid="platform-people"
                    >
                        <dl v-if="traffic" class="grid grid-cols-2 gap-4">
                            <div
                                v-for="item in peopleItems"
                                :key="item.key"
                                :data-testid="`platform-people-${item.key}`"
                            >
                                <dd
                                    class="text-2xl font-bold tabular-nums text-highlighted"
                                >
                                    {{ item.value }}
                                </dd>
                                <dt class="text-xs text-muted">
                                    {{ item.label }}
                                </dt>
                            </div>
                        </dl>
                        <div
                            v-if="signInShares.length"
                            class="mt-4 flex flex-col gap-2"
                        >
                            <div
                                class="flex h-2.5 overflow-hidden rounded-full"
                            >
                                <span
                                    v-for="(entry, index) in signInShares"
                                    :key="entry.method"
                                    :style="{
                                        flex: entry.share,
                                        opacity: 1 - index * 0.25,
                                    }"
                                    class="bg-primary"
                                />
                            </div>
                            <div
                                class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"
                            >
                                <span
                                    v-for="entry in signInShares"
                                    :key="entry.method"
                                >
                                    {{ signInMethodLabel(entry.method) }}
                                    {{ formatPercent(entry.share, locale) }}
                                </span>
                            </div>
                        </div>
                    </AnalyticsSection>
                    <AnalyticsSection
                        :title="t('platform.overview.platform')"
                        icon="i-lucide-building-2"
                        testid="platform-totals"
                    >
                        <dl class="grid grid-cols-2 gap-4">
                            <div
                                v-for="tile in tiles"
                                :key="tile.key"
                                :data-testid="`platform-stat-${tile.key}`"
                            >
                                <dd
                                    class="text-2xl font-bold tabular-nums text-highlighted"
                                    data-testid="stats-card-value"
                                >
                                    {{ tile.value }}
                                </dd>
                                <dt class="text-xs text-muted">
                                    {{ tile.label }}
                                </dt>
                            </div>
                        </dl>
                    </AnalyticsSection>
                    <AnalyticsSection
                        :title="t('platform.overview.servers.title')"
                        icon="i-lucide-server-cog"
                        color="secondary"
                        flush
                        testid="platform-servers"
                    >
                        <PlatformServerList
                            v-if="traffic"
                            :servers="traffic.system.replicas"
                        />
                    </AnalyticsSection>
                    <AnalyticsSection
                        :title="t('platform.overview.system.title')"
                        icon="i-lucide-server"
                        color="secondary"
                        flush
                        testid="platform-system"
                    >
                        <dl
                            v-if="traffic"
                            class="divide-y divide-default text-sm"
                        >
                            <div
                                v-for="item in systemItems"
                                :key="item.key"
                                class="flex items-center gap-3 px-4 py-2.5"
                                :data-testid="`platform-system-${item.key}`"
                            >
                                <dt class="flex-1 text-muted">
                                    {{ item.label }}
                                </dt>
                                <dd class="text-right" :class="item.tone">
                                    <NuxtLink
                                        v-if="item.to"
                                        :to="item.to"
                                        class="hover:underline"
                                    >
                                        {{ item.value }}
                                    </NuxtLink>
                                    <template v-else>{{ item.value }}</template>
                                </dd>
                            </div>
                        </dl>
                    </AnalyticsSection>
                    <AnalyticsSection
                        :title="t('platform.overview.admins')"
                        icon="i-lucide-shield-user"
                        color="secondary"
                        flush
                        testid="platform-admins"
                    >
                        <ul class="divide-y divide-default">
                            <li
                                v-for="admin in admins"
                                :key="admin.id"
                                class="flex items-center gap-3 px-4 py-3"
                                :data-testid="`platform-admin-${admin.id}`"
                            >
                                <ClimberAvatar
                                    :id="admin.id"
                                    :avatar="admin.avatar"
                                    :name="userDisplayName(admin)"
                                />
                                <div class="min-w-0 flex-1">
                                    <p
                                        class="truncate text-sm font-semibold text-highlighted"
                                    >
                                        {{ userDisplayName(admin) }}
                                    </p>
                                    <p class="truncate text-xs text-muted">
                                        {{ admin.email }}
                                    </p>
                                </div>
                            </li>
                        </ul>
                    </AnalyticsSection>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    getPlatformTraffic,
    listPlatformUsers,
    type TrafficRange,
} from '~/api/platform'
import { formatBytes } from '~/utils/backups'
import {
    errorRate,
    formatCompact,
    formatMs,
    formatPercent,
    methodShares,
} from '~/utils/platformTraffic'
import { formatDate } from '#shared/utils/formatting'
import { platformTotals, type PlatformGym } from '~/utils/platformGyms'
import { userDisplayName } from '~/utils/platformUsers'
import { parseDate } from '#shared/utils/formatting'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, te, locale } = useI18n()

useHead({ title: () => t('platform.overview.title') })

const [
    { data: gyms, error: gymsError, refresh: refreshGyms },
    { data: admins, error: adminsError, refresh: refreshAdmins },
] = await Promise.all([
    usePlatformGyms(),
    useAsyncData(
        'platform-admins',
        () =>
            listPlatformUsers({ filter: 'platform_admins' }).then(
                ({ items }) => items,
            ),
        { default: () => [] },
    ),
])

const error = computed(() => gymsError.value || adminsError.value)

const range = ref<TrafficRange>('24h')
const rangeItems = (['1h', '24h', '7d', '30d'] as const).map((value) => ({
    value,
    label: value,
}))
const {
    data: traffic,
    pending: trafficPending,
    error: trafficError,
    refresh: refreshTraffic,
} = useAsyncData('platform-traffic', () => getPlatformTraffic(range.value), {
    watch: [range],
    server: false,
})
let trafficTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    trafficTimer = setInterval(() => refreshTraffic(), 60_000)
})
onBeforeUnmount(() => clearInterval(trafficTimer))

const kpis = computed(() => {
    const data = traffic.value
    const series = data?.series ?? []
    const compact = (value: number) => formatCompact(value, locale.value)
    return [
        {
            key: 'requests',
            label: t('platform.overview.traffic.requests'),
            value: data?.totals.requests ?? null,
            previous: data?.previous.requests ?? null,
            icon: 'i-lucide-activity',
            color: 'primary',
            format: compact,
            spark: series.map((point) => point.requests),
        },
        {
            key: 'peak',
            label: t('platform.overview.traffic.peakRps'),
            value: data?.peak_rps ?? null,
            previous: null,
            icon: 'i-lucide-gauge',
            color: 'secondary',
            format: (value: number) =>
                new Intl.NumberFormat(locale.value, {
                    maximumFractionDigits: 1,
                }).format(value),
            spark: [],
        },
        {
            key: 'errors',
            label: t('platform.overview.traffic.serverErrorRate'),
            value: data ? errorRate(data.totals) : null,
            previous: null,
            icon: 'i-lucide-triangle-alert',
            color: 'error',
            format: (value: number) => formatPercent(value, locale.value),
            spark: series.map((point) =>
                point.requests ? point.server_errors / point.requests : 0,
            ),
        },
        {
            key: 'p95',
            label: t('platform.overview.traffic.p95'),
            value: data?.totals.p95_ms ?? null,
            previous: null,
            icon: 'i-lucide-timer',
            color: 'info',
            format: (value: number) => formatMs(value, locale.value),
            spark: [],
        },
        {
            key: 'visitors',
            label: t('platform.overview.traffic.visitors'),
            value: data?.visitors_per_day ?? null,
            previous: null,
            icon: 'i-lucide-user-round',
            color: 'success',
            format: compact,
            spark: [],
        },
        {
            key: 'online',
            label: t('platform.overview.people.online'),
            value: data?.people.online ?? null,
            previous: null,
            icon: 'i-lucide-radio',
            color: 'warning',
            format: compact,
            spark: [],
        },
    ]
})

const peopleItems = computed(() => {
    const people = traffic.value?.people
    if (!people) return []
    return [
        {
            key: 'online',
            label: t('platform.overview.people.online'),
            value: people.online,
        },
        {
            key: 'signed-in',
            label: t('platform.overview.people.signedIn'),
            value: people.signed_in,
        },
        {
            key: 'new',
            label: t('platform.overview.people.newAccounts'),
            value: people.new_accounts,
        },
        {
            key: 'failed',
            label: t('platform.overview.people.failedLogins'),
            value: people.failed_logins,
        },
    ]
})

const signInShares = computed(() =>
    methodShares(traffic.value?.people.sign_in_methods ?? {}),
)

const PROVIDER_NAMES: Record<string, string> = {
    google: 'Google',
    apple: 'Apple',
    microsoft: 'Microsoft',
    oidc: 'OpenID Connect',
}

function signInMethodLabel(method: string) {
    const [kind, provider] = method.split(':')
    if (kind === 'oauth2') return PROVIDER_NAMES[provider ?? ''] ?? provider
    const key = `platform.overview.people.methods.${kind}`
    return te(key) ? t(key) : method
}

const systemItems = computed(() => {
    const system = traffic.value?.system
    if (!system) return []
    return [
        {
            key: 'database',
            label: t('platform.overview.system.database'),
            value: `${formatBytes(system.database_bytes, locale.value)} · ${t('platform.overview.system.connections', system.database_connections)}`,
        },
        {
            key: 'jobs',
            label: t('platform.overview.system.jobs'),
            value: t('platform.overview.system.jobsState', {
                waiting: system.jobs_waiting,
                running: system.jobs_running,
            }),
        },
        {
            key: 'backup',
            label: t('platform.overview.system.lastBackup'),
            value: system.backup_error
                ? t('platform.backups.lastFailed')
                : system.last_backup
                  ? formatDate(system.last_backup, {
                        locale: locale.value,
                        withTime: true,
                    })
                  : '—',
            tone: system.backup_error ? 'text-error' : undefined,
            to: '/platform/backups',
        },
        {
            key: 'mail',
            label: t('platform.overview.system.mail'),
            value: system.mail_configured
                ? t('platform.overview.system.mailOn')
                : t('platform.overview.system.mailOff'),
            tone: system.mail_configured ? undefined : 'text-warning',
            to: '/platform/settings?section=mail',
        },
    ]
})

function retry() {
    return Promise.all([refreshGyms(), refreshAdmins()])
}

const tiles = computed(() => {
    const totals = platformTotals(gyms.value)
    return [
        {
            key: 'gyms',
            label: t('platform.gyms.title'),
            value: totals.gyms,
            icon: 'i-lucide-building-2',
            color: 'primary',
        },
        {
            key: 'active-gyms',
            label: t('platform.overview.activeGyms'),
            value: totals.activeGyms,
            icon: 'i-lucide-circle-check',
            color: 'success',
        },
        {
            key: 'memberships',
            label: t('platform.overview.memberships'),
            value: totals.members,
            icon: 'i-lucide-users-round',
            color: 'info',
        },
        {
            key: 'routes',
            label: t('platform.overview.routes'),
            value: totals.routes,
            icon: 'i-lucide-waypoints',
            color: 'warning',
        },
    ]
})

const { summary } = useModerationSummary()

const ATTENTION_COLORS: Record<string, string> = {
    error: 'text-error',
    warning: 'text-warning',
    info: 'text-info',
    secondary: 'text-secondary',
}

const STALE_CASE_MS = 3 * 86_400_000

const attentionTiles = computed(() => {
    const now = Date.now()
    const staleGyms = (summary.value?.gyms ?? []).filter(
        (entry) =>
            now - (parseDate(entry.oldest)?.getTime() ?? now) > STALE_CASE_MS,
    ).length
    return [
        {
            key: 'legal',
            label: t('platform.overview.legalReports'),
            value: summary.value?.legal_reports ?? 0,
            icon: 'i-lucide-flag',
            color: 'error',
            to: '/platform/moderation',
        },
        {
            key: 'stale-gyms',
            label: t('platform.overview.staleGyms'),
            value: staleGyms,
            icon: 'i-lucide-clock-alert',
            color: 'warning',
            to: '/platform/moderation',
        },
        {
            key: 'profiles',
            label: t('platform.overview.profiles'),
            value: summary.value?.profiles ?? 0,
            icon: 'i-lucide-circle-user-round',
            color: 'info',
            to: '/platform/moderation',
        },
        {
            key: 'suspended',
            label: t('platform.overview.suspended'),
            value: summary.value?.suspended ?? 0,
            icon: 'i-lucide-ban',
            color: 'secondary',
            to: '/platform/users?show=suspended',
        },
    ]
})

function openCases(gymId: string) {
    return summary.value?.gyms?.find((entry) => entry.gym === gymId)?.open ?? 0
}

function gymCounts(gym: PlatformGym) {
    return [
        {
            key: 'members',
            label: t('members.title'),
            value: gym.members,
            icon: 'i-lucide-users-round',
        },
        {
            key: 'routes',
            label: t('platform.overview.routes'),
            value: gym.routes,
            icon: 'i-lucide-waypoints',
        },
    ]
}
</script>
