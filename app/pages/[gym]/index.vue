<template>
    <div
        class="overview mx-auto flex w-full flex-col gap-6 p-4"
        data-testid="overview"
    >
        <header
            class="flex flex-wrap items-end justify-between gap-4 max-lg:-mb-6 lg:pt-2"
        >
            <div class="min-w-0">
                <h1 class="text-2xl font-bold text-highlighted max-lg:sr-only">
                    {{ (gym && gymTitle(gym)) || $t('overview.title') }}
                </h1>
                <p
                    v-if="gym && gymSubtitle(gym)"
                    class="mt-1 text-muted max-lg:hidden"
                    data-testid="overview-org"
                >
                    {{ gymSubtitle(gym) }}
                </p>
            </div>
            <div class="flex gap-2 max-lg:hidden">
                <UButton
                    :to="gymPath('/routes')"
                    icon="i-lucide-list"
                    :label="
                        $t(
                            'overview.routesCount',
                            { n: routes.length },
                            routes.length,
                        )
                    "
                    data-testid="overview-all-routes"
                />
                <UButton
                    :to="gymPath('/map')"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-map"
                    :label="$t('overview.openMap')"
                    data-testid="overview-open-map"
                />
            </div>
        </header>

        <OverviewGymStatus v-if="gym" :gym="gym" />

        <LayoutLoadError v-if="loadFailed" @retry="retryLoad" />

        <template v-else>
            <CompetitionCard
                v-if="liveCompetition"
                :competition="liveCompetition"
                :to="gymPath(`/competitions/${liveCompetition.id}`)"
                data-testid="overview-competition"
            />

            <div class="overview-grid">
                <div class="flex min-w-0 flex-col gap-6">
                    <LayoutPanel
                        v-if="walls.length"
                        :title="$t('overview.walls')"
                        data-testid="overview-walls"
                    >
                        <template #actions>
                            <UButton
                                :to="gymPath('/map')"
                                color="neutral"
                                variant="ghost"
                                trailing-icon="i-lucide-chevron-right"
                                :label="$t('overview.openMap')"
                            />
                        </template>
                        <OverviewWallRails :walls="walls" :now="now" />
                    </LayoutPanel>

                    <LayoutPanel :title="$t('overview.popular')">
                        <template #actions>
                            <UButton
                                :to="gymPath('/routes')"
                                color="neutral"
                                variant="ghost"
                                trailing-icon="i-lucide-chevron-right"
                                :label="$t('overview.allRoutes')"
                            />
                        </template>
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
                    </LayoutPanel>
                </div>

                <aside class="flex flex-col gap-6 max-lg:order-first">
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

                    <LayoutPanel
                        v-if="topBoard"
                        :title="$t('leaderboard.title')"
                        data-testid="overview-leaderboard"
                    >
                        <template #actions>
                            <SegmentedControl
                                v-if="boardItems.length > 1"
                                v-model="boardKind"
                                :items="boardItems"
                                size="xs"
                                test-id="overview-leaderboard-kind"
                            />
                            <span
                                v-else
                                class="text-sm text-muted"
                                data-testid="overview-leaderboard-kind"
                                >{{ $t(`ticks.kind.${topBoard.kind}`) }}</span
                            >
                            <UButton
                                :to="gymPath('/leaderboard')"
                                color="neutral"
                                variant="ghost"
                                icon="i-lucide-chevron-right"
                                :aria-label="$t('leaderboard.title')"
                                class="icon-btn"
                            />
                        </template>
                        <div class="flex flex-col gap-2">
                            <LeaderboardRow
                                v-for="row in topBoard.rows"
                                :key="row.user"
                                :row="row"
                                linked
                            />
                        </div>
                    </LayoutPanel>
                </aside>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { leaderboardTopic } from '#shared/utils/topics'
import { listRoutes, listWalls } from '~/api/routes'
import type { RouteListItem } from '~/types/models'
import { popularRoutes, sentShare, wallSummaries } from '~/utils/overview'
import { cacheKeys } from '~/utils/realtimeCache'
import { gymSubtitle, gymTitle } from '~/utils/gymNames'
import { listCompetitions } from '~/api/competitions'
import { currentCompetition } from '~/utils/competitions'
import { LEADERBOARD_REFRESH_MS } from '~/utils/leaderboard'

const gymPath = useGymPath()

const POPULAR_LIMIT = 6

definePageMeta({ keepalive: true })

const { t } = useI18n()
const authStore = useAuthStore()
const gymId = useCurrentGymId()
const { tickedRouteIds } = useTickedRoutes()
const isLoggedIn = computed(() => authStore.isValid)
const { gym } = useGym()

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

const setupNow = new Date()
const mountedNow = useMountedNow(15 * 60_000)
const now = computed(() => mountedNow.value ?? setupNow)
const popular = computed(() => popularRoutes(routes.value, POPULAR_LIMIT))
const walls = computed(() =>
    wallSummaries(wallRecords.value, routes.value, now.value),
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
const filledBoards = computed(
    () => boards.value?.boards.filter((board) => board.rows.length) ?? [],
)
const boardItems = computed(() =>
    translatedItems(
        filledBoards.value.map((board) => board.kind),
        'ticks.kind',
        t,
    ),
)
const pickedKind = ref<string | null>(null)
const topBoard = computed(
    () =>
        filledBoards.value.find((board) => board.kind === pickedKind.value) ??
        filledBoards.value[0] ??
        null,
)
const boardKind = computed({
    get: () => topBoard.value?.kind ?? '',
    set: (kind: string) => (pickedKind.value = kind),
})

const progress = computed(() => sentShare(routes.value, tickedRouteIds.value))
const progressPercent = computed(() =>
    progress.value.total
        ? (progress.value.sent / progress.value.total) * 100
        : 0,
)
</script>

<style scoped>
@reference "~/assets/css/main.css";

.overview-popular {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
    column-gap: 16px;
}

.overview-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    align-items: start;
}

@variant lg {
    .overview-grid {
        grid-template-columns: minmax(0, 1fr) 340px;
    }
}
</style>
