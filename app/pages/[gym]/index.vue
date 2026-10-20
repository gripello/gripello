<template>
    <div class="overview mx-auto w-full p-4" data-testid="overview">
        <header class="overview-hero">
            <div class="overview-hero__text">
                <h1 class="overview-hero__title max-lg:sr-only">
                    {{ (gym && gymTitle(gym)) || $t('overview.title') }}
                </h1>
                <p
                    v-if="gym && gymSubtitle(gym)"
                    class="text-muted"
                    data-testid="overview-org"
                >
                    {{ gymSubtitle(gym) }}
                </p>
                <p class="overview-hero__stats" data-testid="overview-stats">
                    {{
                        $t(
                            'overview.routesCount',
                            { n: routes.length },
                            routes.length,
                        )
                    }}
                    ·
                    {{ $t('overview.newCount', { n: freshRoutes.length }) }}
                    <span class="max-lg:hidden">
                        ·
                        <NuxtLink
                            :to="gymPath('/routes')"
                            class="overview-hero__link"
                            data-testid="overview-all-routes"
                            >{{ $t('overview.allRoutes') }} ›</NuxtLink
                        >
                    </span>
                </p>
                <UButton
                    v-if="openLabel"
                    :to="gymPath('/info')"
                    :color="openNow?.open ? 'success' : 'neutral'"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-clock"
                    :label="openLabel"
                    class="mt-2"
                    data-testid="overview-open-status"
                />
            </div>
        </header>

        <LayoutLoadError v-if="loadFailed" @retry="retryLoad" />

        <template v-else>
            <CompetitionCard
                v-if="liveCompetition"
                :competition="liveCompetition"
                :to="gymPath(`/competitions/${liveCompetition.id}`)"
                class="overview-section"
                data-testid="overview-competition"
            />

            <section v-if="freshRoutes.length" class="overview-section">
                <LayoutSectionHeader :title="$t('overview.newRoutes')" />
                <OverviewNewRoutes
                    :routes="freshRoutes"
                    :wall-names="wallNames"
                />
            </section>

            <div class="overview-grid">
                <div class="overview-main">
                    <section v-if="walls.length" class="overview-section">
                        <LayoutSectionHeader :title="$t('overview.walls')">
                            <template #actions>
                                <UButton
                                    :to="gymPath('/map')"
                                    color="neutral"
                                    variant="ghost"
                                    trailing-icon="i-lucide-map"
                                    class="max-lg:hidden"
                                    data-testid="overview-open-map"
                                >
                                    {{ $t('overview.openMap') }}
                                </UButton>
                            </template>
                        </LayoutSectionHeader>
                        <OverviewWallTiles :walls="walls" />
                    </section>

                    <section
                        v-if="resets.length"
                        class="overview-section"
                        data-testid="overview-resets"
                    >
                        <LayoutSectionHeader :title="$t('overview.resets')" />
                        <div class="flex flex-wrap gap-2">
                            <NuxtLink
                                v-for="reset in resets"
                                :key="`${reset.wall.id}-${reset.date}`"
                                :to="{
                                    path: gymPath('/map'),
                                    query: {
                                        location: reset.wall.location,
                                        wall: reset.wall.id,
                                    },
                                }"
                                class="flex min-w-0 items-center gap-3 rounded-lg bg-default px-3 py-2 ring ring-default hover:bg-elevated/50"
                                data-testid="overview-reset"
                            >
                                <UIcon
                                    name="i-lucide-calendar-clock"
                                    class="size-5 shrink-0 text-warning"
                                />
                                <span class="min-w-0">
                                    <span
                                        class="block truncate font-semibold text-highlighted"
                                        >{{ reset.wall.name }}</span
                                    >
                                    <span class="block text-xs text-muted">
                                        {{
                                            $t(
                                                'overview.wallRoutes',
                                                { n: reset.count },
                                                reset.count,
                                            )
                                        }}
                                        ·
                                        {{
                                            formatDate(reset.date, {
                                                locale,
                                            })
                                        }}
                                    </span>
                                </span>
                            </NuxtLink>
                        </div>
                    </section>

                    <section class="overview-section">
                        <LayoutSectionHeader :title="$t('overview.popular')" />
                        <MapRouteList
                            v-if="popular.length"
                            class="overview-popular"
                            :groups="[
                                { id: 'popular', name: '', routes: popular },
                            ]"
                            :show-headings="false"
                            :ticked-ids="tickedRouteIds"
                            :selected-route-id="null"
                            link-rows
                            data-testid="overview-popular"
                        />
                        <LayoutEmptyState
                            v-else
                            icon="i-lucide-star"
                            :title="$t('overview.popularEmpty')"
                        />
                    </section>
                </div>

                <aside class="overview-side">
                    <LayoutPanel
                        v-if="isLoggedIn"
                        :title="$t('overview.progressTitle')"
                        data-testid="overview-progress"
                    >
                        <p class="text-sm">
                            {{
                                $t('overview.progress', {
                                    sent: progress.sent,
                                    total: progress.total,
                                })
                            }}
                        </p>
                        <UProgress
                            :model-value="progressPercent"
                            color="primary"
                            size="lg"
                        />
                    </LayoutPanel>
                    <AuthGuestCta
                        v-else
                        class="max-lg:hidden"
                        redirect="/logbook"
                        test-id-prefix="overview"
                    />

                    <section v-if="topBoard" data-testid="overview-leaderboard">
                        <LayoutSectionHeader :title="$t('leaderboard.title')">
                            <template #actions>
                                <UButton
                                    :to="gymPath('/leaderboard')"
                                    color="neutral"
                                    variant="ghost"
                                    trailing-icon="i-lucide-chevron-right"
                                >
                                    {{ $t(`map.${topBoard.kind}s`) }}
                                </UButton>
                            </template>
                        </LayoutSectionHeader>
                        <div class="flex flex-col gap-2">
                            <LeaderboardRow
                                v-for="row in topBoard.rows"
                                :key="row.user"
                                :row="row"
                                linked
                            />
                        </div>
                    </section>

                    <section v-if="routeBars.length || boulderBars.length">
                        <LayoutSectionHeader
                            :title="$t('overview.gradeSpread')"
                        />
                        <LayoutPanel>
                            <div class="flex flex-col gap-5">
                                <OverviewGradeSpread
                                    :title="$t('map.routes')"
                                    :bars="routeBars"
                                />
                                <OverviewGradeSpread
                                    :title="$t('map.boulders')"
                                    :bars="boulderBars"
                                />
                            </div>
                        </LayoutPanel>
                    </section>
                </aside>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { leaderboardTopic } from '#shared/utils/topics'
import { listRoutes, listWalls } from '~/api/routes'
import type { RouteListItem } from '~/types/models'
import { gradeLabels } from '#shared/utils/grades'
import {
    gradeSpread,
    newRoutes,
    popularRoutes,
    sentShare,
    wallSummaries,
} from '~/utils/overview'
import { cacheKeys } from '~/utils/realtimeCache'
import { gymSubtitle, gymTitle } from '~/utils/gymNames'
import { listCompetitions } from '~/api/competitions'
import { currentCompetition } from '~/utils/competitions'
import { plannedResets } from '~/utils/tvScreen'
import { LEADERBOARD_REFRESH_MS } from '~/utils/leaderboard'
import { formatDate } from '#shared/utils/formatting'

const gymPath = useGymPath()

const POPULAR_LIMIT = 6

definePageMeta({ keepalive: true })

const { t, locale } = useI18n()
const authStore = useAuthStore()
const gymId = useCurrentGymId()
const { tickedRouteIds } = useTickedRoutes()
const { routeGradeSystem, boulderGradeSystem } = useGradeSystems()
const isLoggedIn = computed(() => authStore.isValid)
const { gym } = useGym()
const { status: openNow, label: openLabel } = useOpenStatus(
    () => gym.value?.opening_hours,
)

useSeoMeta({
    title: () => t('page.title.overview'),
    description: () => t('overview.description'),
    ogTitle: () => t('page.title.overview'),
    ogDescription: () => t('overview.description'),
    ogType: 'website',
})

const [
    { data: routeRecords, error: routesError, refresh: refreshRoutes },
    { data: wallRecords, error: wallsError, refresh: refreshWalls },
] = await Promise.all([
    useOfflineData(
        cacheKeys.overviewRoutes,
        () => listRoutes(gymId.value, {}).then((list) => list.items),
        { default: () => [] },
    ),
    useOfflineData(cacheKeys.overviewWalls, () => listWalls(gymId.value), {
        default: () => [],
    }),
])

const loadFailed = computed(() => !!routesError.value || !!wallsError.value)

function retryLoad() {
    return Promise.all([refreshRoutes(), refreshWalls()])
}

const routes = computed<RouteListItem[]>(() =>
    routeRecords.value.map((record) => ({
        ...record,
        creator: [],
        has_ratings: Number(record.ratings_count ?? 0) > 0,
    })),
)

const now = new Date()
const freshRoutes = computed(() => newRoutes(routes.value, now))
const popular = computed(() => popularRoutes(routes.value, POPULAR_LIMIT))
const walls = computed(() => wallSummaries(wallRecords.value, routes.value))
const wallNames = computed(
    () => new Map(wallRecords.value.map((wall) => [wall.id, wall.name])),
)

const routeBars = computed(() =>
    gradeSpread(
        routes.value.filter(
            (route) =>
                route.type === 'Route' &&
                route.grade_system === routeGradeSystem.value,
        ),
        gradeLabels(routeGradeSystem.value),
    ),
)
const boulderBars = computed(() =>
    gradeSpread(
        routes.value.filter(
            (route) =>
                route.type === 'Boulder' &&
                route.grade_system === boulderGradeSystem.value,
        ),
        gradeLabels(boulderGradeSystem.value),
    ),
)

const hydrated = useHydrated()
// "Today" is the viewer's day, which the server can't know.
const resets = computed(() =>
    hydrated.value
        ? plannedResets(routes.value, wallRecords.value, new Date())
        : [],
)

const { data: competitions, refresh: refreshCompetitions } = useLazyAsyncData(
    'overview-competitions',
    () => listCompetitions(gymId.value, { status: ['open'] }),
    { default: () => [] },
)
useGymCompetitionsLive(refreshCompetitions)
const liveCompetition = computed(() =>
    currentCompetition(competitions.value, new Date()),
)

const { data: boards, refresh: refreshBoards } = useLazyAsyncData(
    'overview-leaderboard',
    () => loadTvBoards(gymId.value, 3),
)
useLiveRefresh(() => leaderboardTopic(gymId.value), refreshBoards, {
    delayMs: LEADERBOARD_REFRESH_MS,
})
const topBoard = computed(
    () => boards.value?.boards.find((board) => board.rows.length) ?? null,
)

const progress = computed(() => sentShare(routes.value, tickedRouteIds.value))
const progressPercent = computed(() =>
    progress.value.total
        ? (progress.value.sent / progress.value.total) * 100
        : 0,
)
</script>

<style scoped>
@reference "~/assets/css/main.css";

.overview-hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px 32px;
    padding: 8px 0 24px;
}

.overview-hero__title {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.15;
}

.overview-hero__stats {
    margin: 6px 0 0;
    color: var(--ui-text-muted);
    font-size: 1rem;
}

.overview-hero__link {
    color: var(--ui-primary);
    font-weight: 600;
    text-decoration: none;
}

.overview-hero__link:hover {
    text-decoration: underline;
}

.overview-section {
    margin-bottom: 24px;
}

.overview-main {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.overview-main .overview-section {
    margin-bottom: 0;
}

.overview-popular {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
    column-gap: 16px;
    padding: 4px 8px;
    border-radius: 12px;
    border: 1px solid var(--ui-border);
    background: var(--ui-bg);
}

.overview-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 24px;
    align-items: start;
}

.overview-side {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

@variant max-lg {
    .overview-grid {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
