<template>
    <div class="overview mx-auto w-full p-4" data-testid="overview">
        <header class="overview-hero">
            <div class="overview-hero__text">
                <h1 class="overview-hero__title">
                    {{ orgName || $t('overview.title') }}
                </h1>
                <p class="overview-hero__stats" data-testid="overview-stats">
                    {{ $t('overview.routesCount', { n: routes.length }) }}
                    ·
                    {{ $t('overview.newCount', { n: recentCount }) }}
                    ·
                    <NuxtLink
                        :to="gymPath('/routes')"
                        class="overview-hero__link"
                        data-testid="overview-all-routes"
                        >{{ $t('overview.allRoutes') }} ›</NuxtLink
                    >
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

        <LayoutEmptyState
            v-if="loadFailed"
            variant="error"
            :title="$t('errors.loadFailed')"
            data-testid="load-error"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    data-testid="load-error-retry"
                    @click="retryLoad"
                >
                    {{ $t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <template v-else>
            <section class="overview-section">
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
                                    data-testid="overview-open-map"
                                >
                                    {{ $t('overview.openMap') }}
                                </UButton>
                            </template>
                        </LayoutSectionHeader>
                        <OverviewWallTiles :walls="walls" />
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
                        <UButton
                            to="/logbook"
                            color="neutral"
                            variant="soft"
                            block
                            icon="i-lucide-book-check"
                        >
                            {{ $t('overview.openLogbook') }}
                        </UButton>
                    </LayoutPanel>
                    <AuthGuestCta
                        v-else
                        redirect="/logbook"
                        test-id-prefix="overview"
                    />

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

const gymPath = useGymPath()

const OVERVIEW_FIELDS =
    'id,name,color,grade,grade_system,grade_index,anchor_point,type,location,wall,screw_date,average_rating,ratings_count'
const RECENT_DAYS = 7
const POPULAR_LIMIT = 6

definePageMeta({ keepalive: true })

const { t } = useI18n()
const authStore = useAuthStore()
const gymId = useCurrentGymId()
const { orgName } = useOrgSettings()
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
    useAsyncData(
        cacheKeys.overviewRoutes,
        () =>
            listRoutes(
                gymId.value,
                {},
                {
                    rated: true,
                    fields: OVERVIEW_FIELDS,
                    requestKey: 'overviewRoutes',
                },
            ).then((list) => list.items),
        { default: () => [] },
    ),
    useAsyncData(
        cacheKeys.overviewWalls,
        () =>
            listWalls(
                gymId.value,
                {},
                {
                    fields: 'id,name,location,sort',
                    requestKey: 'overviewWalls',
                },
            ),
        { default: () => [] },
    ),
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
const recentCount = computed(
    () => newRoutes(routes.value, now, RECENT_DAYS).length,
)
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
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
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
