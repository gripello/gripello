<template>
    <div class="route-page">
        <LayoutLoadingState v-if="loading" variant="page" />

        <template v-else-if="metadata">
            <div class="route-layout">
                <RouteHero
                    :route="metadata"
                    :ticked="!!route_id && tickedRouteIds.has(route_id)"
                    :reviews="reviews"
                />

                <div class="route-bar" data-testid="route-bar">
                    <div class="stats-card" data-testid="route-stats">
                        <RouteStatsBar
                            :reviews="reviews"
                            :sends-count="metadata.sends_count"
                            :screw-date="metadata.screw_date"
                            :anchor-point="
                                showAnchorPoint ? metadata.anchor_point : null
                            "
                        />
                    </div>

                    <div
                        v-if="route_id"
                        class="route-actions"
                        data-testid="route-actions"
                    >
                        <UButton
                            v-if="isLoggedIn"
                            color="primary"
                            size="lg"
                            class="grow justify-center lg:grow-0"
                            icon="i-lucide-circle-check"
                            data-testid="tick-open"
                            @click="tickDialog = true"
                        >
                            {{ t('ticks.logAscent') }}
                        </UButton>
                        <UButton
                            :color="isLoggedIn ? 'neutral' : 'primary'"
                            :variant="isLoggedIn ? 'soft' : 'solid'"
                            size="lg"
                            class="grow justify-center lg:grow-0"
                            icon="i-lucide-star-plus"
                            data-testid="review-open-cta"
                            @click="reviewDialog = true"
                        >
                            {{ t('ratings.createReview') }}
                        </UButton>
                        <UDropdownMenu
                            v-if="moreActions.length"
                            :items="moreActions"
                            :content="{ align: 'end' }"
                        >
                            <UButton
                                color="neutral"
                                variant="soft"
                                size="lg"
                                icon="i-lucide-ellipsis-vertical"
                                class="icon-btn"
                                :aria-label="t('table.actions')"
                                data-testid="route-more-actions"
                            />
                        </UDropdownMenu>
                        <TaskDefectDialog
                            v-model="defectDialog"
                            :route-id="route_id"
                            :open-defects="openDefects"
                            @submitted="getOpenDefects"
                        />
                        <TaskFormDialog
                            v-if="can('manage_tasks')"
                            v-model="taskDialog"
                            :route-id="route_id"
                            @saved="getOpenDefects"
                        />
                        <TickDialog
                            v-if="isLoggedIn || tickDialog"
                            v-model="tickDialog"
                            :route-id="route_id"
                            @saved="refreshTickedRoutes()"
                        />
                        <ReviewFormDialog
                            v-model="reviewDialog"
                            :route-id="route_id"
                            :grade-system="metadata?.grade_system"
                            :route-grade="metadata?.grade"
                        />
                    </div>
                </div>

                <div class="route-details" data-testid="route-details">
                    <div
                        v-if="metadata.comment"
                        class="route-details__info mb-4"
                    >
                        <div class="flex items-start gap-2">
                            <UIcon
                                name="i-lucide-info"
                                class="mt-1 size-[16px] text-muted"
                            />
                            <span class="text-sm text-muted italic">{{
                                metadata.comment
                            }}</span>
                        </div>
                    </div>

                    <TaskDefectBanner :defects="openDefects" class="mb-4" />

                    <RouteBetaVideos
                        v-if="route_id"
                        ref="betaVideos"
                        :route-id="route_id"
                        :links="betaLinks"
                        :uploads="betaUploads"
                    />
                </div>

                <div class="route-layout__reviews" data-testid="route-reviews">
                    <RouteReviewsSection
                        v-if="route_id"
                        :reviews="reviews"
                        :route-id="route_id"
                        :target-comment-id="targetCommentId"
                        @deleted="dropReview"
                    />
                </div>
            </div>
        </template>

        <LayoutEmptyState
            v-else
            icon="i-lucide-trash-2"
            :title="t('routes.removed')"
            data-testid="route-removed"
        >
            <template #actions>
                <UButton
                    :to="gymPath('/routes')"
                    color="neutral"
                    variant="outline"
                    data-testid="route-removed-back"
                >
                    {{ t('overview.allRoutes') }}
                </UButton>
            </template>
        </LayoutEmptyState>
    </div>
</template>

<script setup lang="ts">
import { listRouteRatings } from '~/api/ratings'
import { getRoute } from '~/api/routes'
import { listRouteDefects } from '~/api/tasks'
import { isAbortError, isOfflineError } from '~/utils/errors'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { RouteListItem } from '~/types/models'
import {
    formatDate,
    locationName,
    normalizeCreators,
} from '#shared/utils/formatting'
import { formatGrade } from '#shared/utils/grades'
import { sanitizeGymMap } from '#shared/utils/mapGeometry'
import { reviewDisplay } from '~/utils/routeReviews'
import { cacheKeys } from '~/utils/realtimeCache'
import { hasFeature } from '#shared/utils/featureFlags'

const gymPath = useGymPath()
const { gym } = useGym()
const betaLinks = computed(() => hasFeature(gym.value, 'beta_links'))
const betaUploads = computed(() => hasFeature(gym.value, 'beta_uploads'))
const betasEnabled = computed(() => betaLinks.value || betaUploads.value)
const gymId = useCurrentGymId()

definePageMeta({ key: (route) => String(route.query.id ?? '') })

const { t, locale } = useI18n()
const authStore = useAuthStore()
const { can } = usePermissions()
const { data: locationRecords } = useLocations()
const canPlaceOnMap = computed(
    () =>
        !!metadata.value &&
        !metadata.value.archived &&
        can('manage_routes') &&
        !!sanitizeGymMap(
            locationRecords.value.find(
                (record) => record.id === metadata.value?.location,
            )?.map,
        ),
)
const nuxtRoute = useRoute()

const route_id = ref<string | null>((nuxtRoute.query.id as string) || null)

const targetCommentId = ref('')
const loading = ref(true)
const { error: notifyError } = useNotification()

const routeDetail = useOfflineData(
    cacheKeys.route(route_id.value ?? ''),
    async (): Promise<RouteListItem | null> => {
        if (!route_id.value) return null
        try {
            const record = await getRoute(route_id.value, ['location', 'wall'])
            return { ...record, creator: normalizeCreators(record.creator) }
        } catch (err: unknown) {
            const status = (err as { status?: number }).status ?? 0
            if (isOfflineError(err)) throw err
            if (status !== 404) throw createError({ status: status || 503 })
            return null
        }
    },
)

const routeRatings = useOfflineData(
    cacheKeys.ratings(route_id.value ?? ''),
    loadRatings,
    { default: () => [] },
)

async function loadRatings() {
    if (!route_id.value) return []
    try {
        return (await listRouteRatings(route_id.value)).items
    } catch (err: unknown) {
        if (isOfflineError(err)) throw err
        if (!isAbortError(err)) {
            console.error('Error fetching ratings:', err)
            notifyError(t('ratings.loadError'))
        }
        return []
    }
}

const routeDefects = useOfflineData(
    cacheKeys.routeDefects(route_id.value ?? ''),
    () =>
        route_id.value
            ? listRouteDefects(route_id.value).catch((err) => {
                  if (isOfflineError(err)) throw err
                  return []
              })
            : Promise.resolve([]),
    { default: () => [] },
)

const metadata = computed(() => routeDetail.data.value ?? null)
const openDefects = routeDefects.data
const getOpenDefects = () => routeDefects.refresh()

const { isBlocked } = useBlocks()
const reviews = computed(() =>
    routeRatings.data.value
        .filter((rating) => !isBlocked(rating.author?.id))
        .map((rating) => reviewDisplay(rating, t('comments.anonymous'))),
)

function dropReview(id: string) {
    routeRatings.data.value = routeRatings.data.value.filter(
        (rating) => rating.id !== id,
    )
}

const isLoggedIn = authStore.isValid
const betaVideos = useTemplateRef<{ openAdd: () => void }>('betaVideos')
const tickDialog = ref(false)
const reviewDialog = ref(false)
const defectDialog = ref(false)
const taskDialog = ref(false)
const moreActions = computed<DropdownMenuItem[][]>(() => {
    const record = metadata.value
    const id = route_id.value
    if (!record || !id) return []
    const climber: DropdownMenuItem[] = []
    if (!record.archived && betasEnabled.value) {
        climber.push({
            label: t('beta.add'),
            icon: 'i-lucide-video',
            'data-testid': 'beta-add',
            onSelect: () => betaVideos.value?.openAdd(),
        })
    }
    if (record.wall && record.location) {
        climber.push({
            label: t('map.showOnMap'),
            icon: 'i-lucide-map-pin',
            to: {
                path: gymPath('/map'),
                query: { location: record.location, route: id },
            },
            'data-testid': 'route-show-on-map',
        })
    }
    if (!record.archived) {
        climber.push({
            label: t('tasks.defect.reportAction'),
            icon: 'i-lucide-wrench',
            'data-testid': 'task-defect-open',
            onSelect: () => (defectDialog.value = true),
        })
    }
    const staff: DropdownMenuItem[] = []
    if (!(record.wall && record.location) && canPlaceOnMap.value) {
        staff.push({
            label: t('mapPlacement.placeThis'),
            icon: 'i-lucide-map-pin-plus',
            to: {
                path: gymPath('/manage/map'),
                query: { location: record.location, route: id },
            },
            'data-testid': 'route-place-on-map',
        })
    }
    if (can('manage_tasks')) {
        staff.push({
            label: t('tasks.addForRoute'),
            icon: 'i-lucide-list-plus',
            'data-testid': 'route-add-task',
            onSelect: () => (taskDialog.value = true),
        })
    }
    return [climber, staff].filter((group) => group.length)
})
const { tickedRouteIds, refreshTickedRoutes } = useTickedRoutes()

// ── Page meta ──────────────────────────────────────────────────────────────

useHead(
    computed(() => ({
        title: metadata.value?.name
            ? t('page.title.routeNamed', { name: metadata.value.name })
            : t('page.title.route'),
    })),
)

// ── Computed ───────────────────────────────────────────────────────────────

const difficulty = computed(() => formatGrade(metadata.value))

const formattedScrewDate = computed(() =>
    formatDate(metadata.value?.screw_date, {
        locale: locale.value,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }),
)

const seoDescription = () =>
    [difficulty.value, locationName(metadata.value), formattedScrewDate.value]
        .filter(Boolean)
        .join(' · ')

useSeoMeta({
    description: seoDescription,
    ogTitle: () => metadata.value?.name || t('page.title.route'),
    ogDescription: seoDescription,
    ogType: 'article',
})

const showAnchorPoint = computed(
    () => !!metadata.value?.anchor_point && metadata.value.type !== 'Boulder',
)

// ── Lifecycle ──────────────────────────────────────────────────────────────

await Promise.all([routeDetail, routeRatings, routeDefects])

const detailError = routeDetail.error.value
if (detailError)
    throw createError({
        status: isOfflineError(detailError.cause ?? detailError)
            ? 503
            : detailError.status || 503,
        fatal: true,
    })
if (!metadata.value) throw createError({ status: 404, fatal: true })
if (routeDetail.data.value?.gym && routeDetail.data.value.gym !== gymId.value)
    await navigateTo(
        { path: '/route', query: nuxtRoute.query },
        { replace: true, redirectCode: 302 },
    )

loading.value = false

onMounted(async () => {
    const hash = window.location.hash
    if (hash.startsWith('#comment-')) {
        targetCommentId.value = hash.slice('#comment-'.length)
        await nextTick()
        document
            .getElementById(`comment-${targetCommentId.value}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.route-layout {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.route-bar {
    position: relative;
    z-index: 2;
    margin: -16px 16px 0;
}

.stats-card {
    background: var(--ui-bg);
    border-radius: 12px;
    @apply shadow-md;
}

.route-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
}

.route-details {
    padding: 16px 16px 0;
}

.route-layout__reviews {
    padding: 8px 16px 24px;
}

@variant sm {
    .route-page {
        padding: 16px 16px 0;
    }

    .route-bar {
        margin-inline: 0;
    }

    .stats-card {
        border-radius: 16px;
    }

    .route-details {
        padding-inline: 0;
    }

    .route-layout__reviews {
        padding-inline: 0;
    }
}

@variant lg {
    .route-bar {
        margin-top: -28px;
        display: flex;
        align-items: center;
        gap: 24px;
        padding: 0 16px 0 40px;
        background: var(--ui-bg);
        border-radius: 16px;
        @apply shadow-md;
    }

    .stats-card {
        background: none;
        box-shadow: none;
    }

    .route-actions {
        margin: 0 0 0 auto;
        flex-wrap: nowrap;
    }

    .route-details {
        padding-top: 24px;
    }
}
</style>
