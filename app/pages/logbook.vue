<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader
            :title="t('ticks.logbook')"
            :subtitle="t('ticks.logbookSubtitle')"
        >
            <template v-if="allTicks.length" #actions>
                <div class="flex flex-wrap gap-2">
                    <USelect
                        v-if="tickGyms.length > 1"
                        v-model="gymId"
                        :items="gymItems"
                        size="sm"
                        class="min-w-40"
                        :aria-label="t('ticks.gym')"
                        data-testid="logbook-gym"
                    />
                    <SegmentedControl
                        v-model="kind"
                        :items="kindItems"
                        size="sm"
                        test-id="logbook-kind"
                    />
                    <SegmentedControl
                        v-model="range"
                        :items="rangeItems"
                        size="sm"
                        test-id="logbook-range"
                    />
                </div>
            </template>
        </LayoutPageHeader>

        <LayoutEmptyState
            v-if="ticksError"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="load-error"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    data-testid="load-error-retry"
                    @click="retry()"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <template v-else-if="!allTicks.length">
            <LayoutEmptyState
                icon="i-lucide-notebook"
                :title="t('ticks.empty')"
                :hint="t('ticks.emptyHint')"
                class="mb-6"
                data-testid="logbook-empty"
            />
            <LogbookTimeline
                :ticks="[]"
                :gym-id="ALL_GYMS"
                :title="t('ticks.tabs.timeline')"
                class="mb-6"
            />
            <LogbookSuggestions :kind="null" :target-index="null" />
        </template>

        <template v-else>
            <div class="mb-3 grid grid-cols-12 gap-3">
                <div
                    v-for="tile in tiles"
                    :key="tile.key"
                    class="col-span-6 md:col-span-3 flex"
                    :data-testid="`logbook-stat-${tile.key}`"
                >
                    <AnalyticsStatsCard
                        class="w-full"
                        :title="tile.title"
                        :value="tile.value"
                        :previous="tile.previous"
                        :icon="tile.icon"
                        :color="tile.color"
                        :format="tile.format"
                        :meter="tile.meter"
                        :subtitle="tile.subtitle"
                    />
                </div>
            </div>

            <div
                role="tablist"
                class="mb-4 flex gap-1 overflow-x-auto border-b"
                data-testid="logbook-tabs"
            >
                <UButton
                    v-for="option in LOGBOOK_TABS"
                    :key="option"
                    role="tab"
                    :aria-selected="tab === option"
                    color="neutral"
                    variant="ghost"
                    :class="[
                        '-mb-px shrink-0 rounded-none border-b-2',
                        tab === option
                            ? 'border-primary text-primary'
                            : 'border-transparent',
                    ]"
                    :data-testid="`logbook-tab-${option}`"
                    @click="tab = option"
                >
                    {{ t(`ticks.tabs.${option}`) }}
                    <UBadge
                        v-if="option === 'projects' && projects.length"
                        size="sm"
                        color="neutral"
                        variant="soft"
                        class="ms-2"
                        data-testid="logbook-projects-count"
                    >
                        {{ projects.length }}
                    </UBadge>
                </UButton>
            </div>

            <div v-if="tab === 'sessions'" role="tabpanel">
                <div class="grid grid-cols-12 gap-3">
                    <div
                        v-for="(session, index) in sessions"
                        :key="session.day"
                        class="col-span-12 lg:col-span-6"
                    >
                        <LogbookSessionCard
                            :day="session.day"
                            :ticks="session.ticks"
                            :initially-open="index < 2"
                            @edit="openEdit"
                            @delete="deleteTarget = $event"
                        />
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'timeline'" role="tabpanel">
                <LogbookTimeline :ticks="allTicks" :gym-id="gymId" />
            </div>

            <div v-else-if="tab === 'stats'" role="tabpanel">
                <div class="grid grid-cols-12 gap-3">
                    <div class="col-span-12 md:col-span-6">
                        <AnalyticsSection
                            :title="t('ticks.pyramid.title')"
                            :subtitle="t('ticks.pyramid.subtitle')"
                            icon="i-lucide-triangle"
                            :empty="!pyramid.length"
                            :empty-text="t('ticks.chartEmpty')"
                            testid="logbook-section-pyramid"
                        >
                            <LogbookPyramidChart :rows="pyramid" />
                        </AnalyticsSection>
                    </div>
                    <div class="col-span-12 md:col-span-6">
                        <AnalyticsSection
                            :title="t('ticks.progression.title')"
                            :subtitle="t('ticks.progression.subtitle')"
                            icon="i-lucide-chart-line"
                            :empty="!progressionPoints.some((p) => p.sends)"
                            :empty-text="t('ticks.chartEmpty')"
                            testid="logbook-section-progression"
                        >
                            <LogbookProgressionChart
                                :points="progressionPoints"
                                :system="gradeSystemFor(routeType)"
                            />
                        </AnalyticsSection>
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'badges'" role="tabpanel">
                <BadgesGrid :user-id="myUserId" />
            </div>

            <div v-else role="tabpanel">
                <LogbookProjects
                    v-if="projects.length"
                    :projects="projects"
                    @log="openLog"
                />
                <LayoutEmptyState
                    v-else
                    icon="i-lucide-target"
                    :title="t('ticks.projects.empty')"
                    :hint="t('ticks.projects.emptyHint')"
                    class="mb-6"
                    data-testid="logbook-projects-empty"
                />
                <LogbookSuggestions
                    v-if="!projects.length"
                    :kind="kind"
                    :target-index="targetIndex"
                />
            </div>
        </template>

        <TickDialog
            v-model="editOpen"
            :tick="editing"
            :route-id="logRouteId"
            @saved="reload"
        />

        <ConfirmDialog
            :model-value="!!deleteTarget"
            :title="t('actions.confirm')"
            :message="t('ticks.deleteConfirm')"
            :loading="deleting"
            @update:model-value="deleteTarget = null"
            @confirm="confirmDelete"
        />
    </div>
</template>

<script setup lang="ts">
import type { RouteRecord, TickRecord } from '~/types/models'
import { groupTicksByDay } from '#shared/utils/ticks'
import {
    gradePyramid,
    logbookStats,
    medianSendIndex,
    openProjects,
    preferredKind,
    progression,
    type LogbookKind,
    type LogbookRange,
    type LogbookTick,
} from '#shared/utils/logbook'
import { applyTickOutbox, isOfflineError } from '~/utils/tickOutbox'
import { cacheKeys } from '~/utils/realtimeCache'
import { ALL_GYMS, gymsInTicks, ticksInGym } from '~/utils/logbookGyms'

type LoggedTick = TickRecord & { expand?: { route?: RouteRecord } }

const LOGBOOK_KINDS: LogbookKind[] = ['boulder', 'route']
const LOGBOOK_RANGES: LogbookRange[] = ['30d', '12m', 'all']
const kindItems = computed(() =>
    LOGBOOK_KINDS.map((value) => ({ value, label: t(`ticks.kind.${value}`) })),
)
const rangeItems = computed(() =>
    LOGBOOK_RANGES.map((value) => ({
        value,
        label: t(`ticks.range.${value}`),
    })),
)
const LOGBOOK_TABS = [
    'sessions',
    'timeline',
    'stats',
    'projects',
    'badges',
] as const

const { t } = useI18n()
const pb = usePocketbase()
const { notify, error: notifyError } = useNotification()
const { refreshTickedRoutes } = useTickedRoutes()
const outbox = useTickOutbox()
const { gradeSystemFor } = useGradeSystems()

useHead({ title: t('page.title.logbook') })

definePageMeta({
    middleware: ['auth'],
    keepalive: true,
})

// ponytail: loads the whole logbook at once, paginate by session once logbooks grow into the thousands
const {
    data: ticks,
    error: ticksError,
    refresh,
} = await useAsyncData(
    cacheKeys.logbook,
    async () => {
        try {
            const list = await pb.collection('ticks').getFullList<LoggedTick>({
                sort: '-date,-created',
                expand: 'route.gym',
                requestKey: null,
            })
            outbox.cacheTicks(list)
            return list
        } catch (error) {
            if (!isOfflineError(error)) throw error
            return outbox.cachedTicks<LoggedTick>()
        }
    },
    { default: () => [] },
)

const allTicks = computed(() =>
    applyTickOutbox(
        ticks.value,
        outbox.queue.value,
        pb.authStore.record?.id,
    ).map((tick) => ({
        ...tick,
        routeArchived: !!tick.expand?.route?.archived,
    })),
)
const tickGyms = computed(() => gymsInTicks(allTicks.value))
const myUserId = pb.authStore.record?.id ?? ''
const gymId = ref(ALL_GYMS)
const gymItems = computed(() => [
    { label: t('ticks.allGyms'), value: ALL_GYMS },
    ...tickGyms.value.map((gym) => ({ label: gym.name, value: gym.id })),
])
const logbookTicks = computed(() => ticksInGym(allTicks.value, gymId.value))

const kind = ref<LogbookKind>(preferredKind(logbookTicks.value))
const range = ref<LogbookRange>('12m')
const tab = ref<(typeof LOGBOOK_TABS)[number]>('sessions')
const routeType = computed(() =>
    kind.value === 'boulder' ? 'Boulder' : 'Route',
)

const sessions = computed(() => groupTicksByDay(logbookTicks.value))
const stats = computed(() =>
    logbookStats(logbookTicks.value, kind.value, range.value),
)
const pyramid = computed(() =>
    gradePyramid(logbookTicks.value, kind.value, range.value),
)
const progressionPoints = computed(() =>
    progression(logbookTicks.value, kind.value),
)
const targetIndex = computed(() =>
    medianSendIndex(logbookTicks.value, kind.value),
)

const routesById = computed(
    () =>
        new Map(
            logbookTicks.value
                .map((tick) => tick.expand?.route)
                .filter((route): route is RouteRecord => !!route)
                .map((route) => [route.id, route]),
        ),
)
const projects = computed(() =>
    openProjects(logbookTicks.value).map((project) => ({
        ...project,
        record: routesById.value.get(project.route),
    })),
)

const tiles = computed(() => {
    const { current, previous } = stats.value
    const percent = (value: number | null) =>
        value === null ? null : Math.round(value * 100)
    return [
        {
            key: 'sends',
            title: t('ticks.stats.sends'),
            value: current.sends,
            previous: previous?.sends ?? null,
            icon: 'i-lucide-flag-triangle-right',
            color: 'success',
            format: undefined,
            meter: undefined,
            subtitle: undefined,
        },
        {
            key: 'hardest',
            title: t('ticks.stats.hardest'),
            value: current.hardest?.grade_index ?? null,
            previous: null,
            icon: 'i-lucide-trending-up',
            color: 'primary',
            format: () => current.hardest?.grade ?? '—',
            meter: undefined,
            subtitle: previous?.hardest
                ? t('ticks.stats.previousHardest', {
                      grade: previous.hardest.grade,
                  })
                : undefined,
        },
        {
            key: 'flashRate',
            title: t('ticks.stats.flashRate'),
            value: percent(current.flashRate),
            previous: percent(previous?.flashRate ?? null),
            icon: 'i-lucide-zap',
            color: 'warning',
            format: (value: number) => `${value}%`,
            meter: current.flashRate ?? undefined,
            subtitle: undefined,
        },
        {
            key: 'sessions',
            title: t('ticks.stats.sessions'),
            value: current.sessions,
            previous: previous?.sessions ?? null,
            icon: 'i-lucide-calendar-check',
            color: 'info',
            format: undefined,
            meter: undefined,
            subtitle: undefined,
        },
    ]
})

const editOpen = ref(false)
const editing = ref<TickRecord | null>(null)
const logRouteId = ref<string | null>(null)
const deleteTarget = ref<TickRecord | null>(null)
const deleting = ref(false)

function retry() {
    return Promise.all([refresh(), refreshNuxtData('my-contributions')])
}

function reload() {
    return refreshTickedRoutes()
}

function openEdit(tick: TickRecord) {
    logRouteId.value = null
    editing.value = tick
    editOpen.value = true
}

function openLog(routeId: string) {
    editing.value = null
    logRouteId.value = routeId
    editOpen.value = true
}

async function confirmDelete() {
    if (!deleteTarget.value) return
    deleting.value = true
    try {
        await outbox.deleteTick(deleteTarget.value.id)
        notify(t('ticks.deleted'))
        deleteTarget.value = null
        await reload()
    } catch (err) {
        console.error('Deleting tick failed:', err)
        notifyError(t('notifications.error.delete'))
    } finally {
        deleting.value = false
    }
}
</script>
