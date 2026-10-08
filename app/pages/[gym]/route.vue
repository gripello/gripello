<template>
    <div class="route-page">
        <LayoutLoadingState v-if="loading" variant="page" />

        <template v-else-if="metadata">
            <div class="route-layout">
                <div class="route-layout__main">
                    <div
                        class="route-hero"
                        data-testid="route-hero"
                        :style="heroStyle"
                    >
                        <div class="route-hero__overlay" />
                        <UButton
                            icon="i-lucide-arrow-left"
                            color="neutral"
                            class="icon-btn route-hero__back bg-(--hero-tint) text-(--hero-ink) hover:bg-(--hero-tint)/80 rounded-full"
                            :aria-label="t('errors.goBack')"
                            data-testid="route-back"
                            @click="goBack"
                        />
                        <div class="route-hero__content">
                            <div
                                class="route-hero__chips"
                                data-testid="route-hero-chips"
                            >
                                <UBadge
                                    v-if="metadata.type"
                                    size="lg"
                                    color="neutral"
                                    class="bg-(--hero-tint) text-(--hero-ink) hover:bg-(--hero-tint)/80 rounded-full"
                                    data-testid="route-type-chip"
                                    :icon="
                                        metadata.type === 'Boulder'
                                            ? 'i-lucide-mountain'
                                            : 'i-lucide-route'
                                    "
                                >
                                    {{
                                        t(
                                            `routes.types.${metadata.type?.toLowerCase()}`,
                                        )
                                    }}
                                </UBadge>
                                <UBadge
                                    v-if="
                                        route_id && tickedRouteIds.has(route_id)
                                    "
                                    size="lg"
                                    color="primary"
                                    class="rounded-full"
                                    icon="i-lucide-check"
                                    data-testid="route-ticked"
                                >
                                    {{ t('ticks.sent') }}
                                </UBadge>
                                <UBadge
                                    v-if="locationName(metadata)"
                                    size="lg"
                                    color="neutral"
                                    class="bg-(--hero-tint) text-(--hero-ink) hover:bg-(--hero-tint)/80 rounded-full"
                                    icon="i-lucide-map-pin"
                                >
                                    {{ locationName(metadata) }}
                                </UBadge>
                                <UBadge
                                    v-if="wallName(metadata)"
                                    size="lg"
                                    color="neutral"
                                    class="bg-(--hero-tint) text-(--hero-ink) hover:bg-(--hero-tint)/80 rounded-full"
                                    icon="i-lucide-brick-wall"
                                    data-testid="route-wall"
                                >
                                    {{ wallName(metadata) }}
                                </UBadge>
                            </div>

                            <div class="route-hero__headline">
                                <div class="route-hero__name">
                                    <h1
                                        class="text-2xl font-bold mb-1 route-hero__ink route-hero__title"
                                        data-testid="route-page-name"
                                    >
                                        {{ metadata.name }}
                                    </h1>

                                    <div
                                        v-if="metadata.creator?.length"
                                        class="flex items-center gap-1 mt-1"
                                    >
                                        <UIcon
                                            name="i-lucide-hard-hat"
                                            class="route-hero__ink-muted size-[14px]"
                                        />
                                        <span
                                            class="text-sm route-hero__ink-muted"
                                            >{{
                                                metadata.creator.join(', ')
                                            }}</span
                                        >
                                    </div>
                                </div>

                                <GradeConversionDialog
                                    v-if="difficulty"
                                    :source="metadata"
                                >
                                    <template #activator="{ props: activator }">
                                        <button
                                            v-bind="activator"
                                            type="button"
                                            class="route-hero__difficulty-badge"
                                            :style="difficultyBadgeStyle"
                                            :aria-label="
                                                t('gradeConversion.show')
                                            "
                                            :title="t('gradeConversion.show')"
                                            data-testid="route-grade-badge"
                                        >
                                            <span
                                                class="route-hero__difficulty-text font-black"
                                                >{{ difficulty }}</span
                                            >
                                            <span
                                                v-if="metadata?.grade_system"
                                                class="route-hero__difficulty-system"
                                                data-testid="route-grade-system"
                                                >{{
                                                    t(
                                                        `gradeSystemsShort.${metadata.grade_system}`,
                                                    )
                                                }}</span
                                            >
                                            <span
                                                v-if="gymBand"
                                                class="route-hero__difficulty-band"
                                                :style="{
                                                    background: gymBand.color,
                                                }"
                                                :title="bandName(gymBand)"
                                                :data-band="gymBand.key"
                                                data-testid="route-grade-band"
                                            />
                                        </button>
                                    </template>
                                </GradeConversionDialog>
                            </div>
                        </div>
                    </div>

                    <div
                        class="stats-card mx-4 -mt-4 rounded-lg shadow-md lg:m-0 lg:mr-8"
                        data-testid="route-stats"
                    >
                        <div class="flex items-center justify-around py-3">
                            <LayoutStatTile
                                :label="t('ratings.score')"
                                :value="avgRating"
                                icon="i-lucide-star"
                                icon-color="yellow-darken-2"
                                data-testid="route-avg-rating"
                            />
                            <USeparator
                                orientation="vertical"
                                class="my-1 h-10"
                            />
                            <LayoutStatTile
                                :label="t('ratings.climber_reviews')"
                                :value="reviews.length"
                            />
                            <USeparator
                                orientation="vertical"
                                class="my-1 h-10"
                            />
                            <LayoutStatTile
                                :label="t('ratings.difficulty')"
                                :value="avgPerceivedDifficulty || '—'"
                                icon="i-lucide-trending-up"
                                icon-color="primary"
                            />
                        </div>
                    </div>

                    <div class="route-details" data-testid="route-details">
                        <div
                            v-if="formattedScrewDate || metadata.comment"
                            class="mb-4"
                        >
                            <div
                                v-if="formattedScrewDate"
                                class="flex items-center gap-2 mb-2"
                            >
                                <UIcon
                                    name="i-lucide-calendar"
                                    class="size-[16px] text-muted"
                                />
                                <span class="text-sm text-muted">{{
                                    formattedScrewDate
                                }}</span>
                            </div>
                            <div
                                v-if="
                                    metadata.anchor_point &&
                                    metadata.type !== 'Boulder'
                                "
                                class="flex items-center gap-2 mb-2"
                            >
                                <UIcon
                                    name="i-lucide-hash"
                                    class="size-[16px] text-muted"
                                />
                                <span class="text-sm text-muted"
                                    >{{ t('climbing.anchor_point') }}:
                                    {{ metadata.anchor_point }}</span
                                >
                            </div>
                            <div
                                v-if="metadata.comment"
                                class="flex items-start gap-2"
                            >
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

                        <div v-if="route_id" class="flex flex-wrap gap-2 mb-6">
                            <UButton
                                v-if="isLoggedIn"
                                color="primary"
                                size="lg"
                                class="grow justify-center"
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
                                class="grow justify-center"
                                icon="i-lucide-star-plus"
                                data-testid="review-open-cta"
                                @click="reviewDialog = true"
                            >
                                {{ t('ratings.createReview') }}
                            </UButton>
                            <UButton
                                v-if="!metadata.archived && betasEnabled"
                                color="neutral"
                                variant="soft"
                                size="lg"
                                class="grow justify-center"
                                icon="i-lucide-video"
                                data-testid="beta-add"
                                @click="betaVideos?.openAdd()"
                            >
                                {{ t('beta.add') }}
                            </UButton>
                            <UButton
                                v-if="metadata?.wall && metadata.location"
                                color="neutral"
                                variant="soft"
                                size="lg"
                                class="grow justify-center"
                                icon="i-lucide-map-pin"
                                :to="{
                                    path: gymPath('/map'),
                                    query: {
                                        location: metadata.location,
                                        route: route_id,
                                    },
                                }"
                                data-testid="route-show-on-map"
                            >
                                {{ t('map.showOnMap') }}
                            </UButton>
                            <UButton
                                v-else-if="canPlaceOnMap"
                                color="neutral"
                                variant="soft"
                                size="lg"
                                class="grow justify-center"
                                icon="i-lucide-map-pin-plus"
                                :to="{
                                    path: gymPath('/manage/map'),
                                    query: {
                                        location: metadata?.location,
                                        route: route_id,
                                    },
                                }"
                                data-testid="route-place-on-map"
                            >
                                {{ t('mapPlacement.placeThis') }}
                            </UButton>
                            <UButton
                                v-if="!metadata.archived"
                                color="neutral"
                                variant="soft"
                                size="lg"
                                class="grow justify-center"
                                icon="i-lucide-wrench"
                                data-testid="task-defect-open"
                                @click="defectDialog = true"
                            >
                                {{ t('tasks.defect.reportAction') }}
                            </UButton>
                            <UButton
                                v-if="can('manage_tasks')"
                                color="neutral"
                                variant="soft"
                                size="lg"
                                class="grow justify-center"
                                icon="i-lucide-list-plus"
                                data-testid="route-add-task"
                                @click="taskDialog = true"
                            >
                                {{ t('tasks.addForRoute') }}
                            </UButton>
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
                                v-if="isLoggedIn"
                                v-model="tickDialog"
                                :route-id="route_id"
                                @saved="refreshTickedRoutes()"
                            />
                            <ReviewFormDialog
                                v-model="reviewDialog"
                                :route-id="route_id"
                                :grade-system="metadata?.grade_system"
                            />
                        </div>
                    </div>
                </div>

                <div
                    class="route-layout__reviews px-4 pt-4"
                    data-testid="route-reviews"
                >
                    <RouteBetaVideos
                        v-if="route_id"
                        ref="betaVideos"
                        :route-id="route_id"
                    />

                    <div class="mb-3 flex items-center gap-2">
                        <h2 class="text-base font-bold">
                            {{ t('ratings.climber_reviews') }}
                        </h2>
                        <UBadge
                            v-if="reviews.length"
                            variant="soft"
                            color="primary"
                            class="rounded-full"
                        >
                            {{ reviews.length }}
                        </UBadge>
                    </div>

                    <div v-if="reviews.length" class="route-reviews-list">
                        <CommentsCard
                            v-for="review in reviews"
                            :key="review.id"
                            :comment="review"
                            date-format="relative"
                            actions-in-header
                            class="mb-3"
                            :class="{
                                'comment-card--target':
                                    review.id === targetCommentId,
                            }"
                        >
                            <template #actions>
                                <UButton
                                    v-if="!review.mine"
                                    icon="i-lucide-flag"
                                    color="neutral"
                                    variant="ghost"
                                    class="icon-btn"
                                    :aria-label="t('reports.reportAction')"
                                    :title="t('reports.reportAction')"
                                    data-testid="comment-card-report"
                                    @click="openReport(review.id)"
                                />
                                <UButton
                                    v-else
                                    icon="i-lucide-trash-2"
                                    color="neutral"
                                    variant="ghost"
                                    class="icon-btn"
                                    :aria-label="t('ratings.deleteOwn')"
                                    :title="t('ratings.deleteOwn')"
                                    data-testid="comment-card-delete"
                                    @click="deleteTarget = review.id"
                                />
                            </template>
                        </CommentsCard>
                    </div>

                    <LayoutEmptyState
                        v-else
                        icon="i-lucide-sparkles"
                        :title="t('ratings.no_reviews_yet')"
                        :hint="t('ratings.be_the_first')"
                    />

                    <ConfirmDialog
                        :model-value="!!deleteTarget"
                        :title="t('ratings.deleteOwn')"
                        :message="t('ratings.deleteOwnConfirm')"
                        :confirm-text="t('actions.delete')"
                        @update:model-value="deleteTarget = null"
                        @confirm="deleteOwnReview"
                    />

                    <ReportsFormDialog
                        v-if="reportTarget"
                        v-model="reportDialog"
                        content-type="rating"
                        :content-id="reportTarget"
                        :content-url="reportUrl"
                    />

                    <div class="route-page__bottom-spacer" />
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { isAbortError } from '~/utils/errors'
import type PocketBase from 'pocketbase'
import type {
    OpenRouteDefectRecord,
    RatingRecord,
    RouteListItem,
    RouteRecord,
} from '~/types/models'
import {
    formatDate,
    locationName,
    wallName,
    normalizeCreators,
} from '#shared/utils/formatting'
import { formatGrade } from '#shared/utils/grades'
import { gymBandFor } from '#shared/utils/gradeReference'
import { formatNumber } from '#shared/utils/number'
import { sanitizeGymMap } from '#shared/utils/mapGeometry'
import { reportContentUrl } from '~/utils/reports'
import { isLightColor, shadeColor } from '~/utils/color'
import { cacheKeys } from '~/utils/realtimeCache'
import { hasFeature } from '#shared/utils/featureFlags'

const gymPath = useGymPath()
const { gym } = useGym()
const betasEnabled = computed(() => hasFeature(gym.value, 'beta_videos'))
const gymId = useCurrentGymId()

definePageMeta({ key: (route) => String(route.query.id ?? '') })

const { t, locale } = useI18n()
const pb = usePocketbase() as PocketBase
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

const routeDetail = useAsyncData(
    cacheKeys.route(route_id.value ?? ''),
    async (): Promise<RouteListItem | null> => {
        if (!route_id.value) return null
        try {
            const record = await pb
                .collection('routes')
                .getOne<RouteRecord>(route_id.value, {
                    expand: 'location,wall',
                })
            return { ...record, creator: normalizeCreators(record.creator) }
        } catch (err: unknown) {
            const status = (err as { status?: number }).status ?? 0
            if (status !== 404) throw createError({ status: status || 503 })
            return null
        }
    },
)

const routeRatings = useAsyncData(
    cacheKeys.ratings(route_id.value ?? ''),
    async () => {
        if (!route_id.value) return []
        try {
            return await pb.collection('ratings').getFullList<RatingRecord>({
                filter: pb.filter('route_id = {:id}', { id: route_id.value }),
                sort: '-created',
                requestKey: null,
            })
        } catch (err: unknown) {
            if (!isAbortError(err)) {
                console.error('Error fetching ratings:', err)
                notifyError(t('ratings.loadError'))
            }
            return []
        }
    },
    { default: () => [] },
)

const routeDefects = useAsyncData(
    cacheKeys.routeDefects(route_id.value ?? ''),
    () =>
        route_id.value
            ? pb
                  .collection('open_route_defects')
                  .getFullList<OpenRouteDefectRecord>({
                      filter: pb.filter('route = {:id}', {
                          id: route_id.value,
                      }),
                      requestKey: null,
                  })
                  .catch(() => [])
            : Promise.resolve([]),
    { default: () => [] },
)

const metadata = computed(() => routeDetail.data.value ?? null)
const openDefects = routeDefects.data
const getOpenDefects = () => routeDefects.refresh()

interface ReviewDisplay {
    id: string
    rating: number | null
    difficultyLabel: string
    comment: string | null
    created: string
    userName: string
    userAvatar: string | null
    userId?: string
    mine: boolean
}

const { isBlocked } = useBlocks()
const reviews = computed(() =>
    routeRatings.data.value
        .filter((rating) => !isBlocked(rating.author?.id))
        .map(mapReview),
)

const reportDialog = ref(false)
const reportTarget = ref<string | null>(null)
const reportUrl = computed(() =>
    reportTarget.value
        ? reportContentUrl('rating', reportTarget.value, route_id.value)
        : '',
)

function openReport(id: string) {
    reportTarget.value = id
    reportDialog.value = true
}

const deleteTarget = ref<string | null>(null)
async function deleteOwnReview() {
    const id = deleteTarget.value
    deleteTarget.value = null
    if (!id) return
    try {
        await pb.collection('ratings').delete(id)
        routeRatings.data.value = routeRatings.data.value.filter(
            (rating) => rating.id !== id,
        )
    } catch (error) {
        console.error(error)
        notifyError(t('notifications.error.generic'))
    }
}

const isLoggedIn = pb.authStore.isValid
const betaVideos = useTemplateRef<{ openAdd: () => void }>('betaVideos')
const tickDialog = ref(false)
const reviewDialog = ref(false)
const defectDialog = ref(false)
const taskDialog = ref(false)
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

const themeColors = useThemeColors()
const heroColor = computed(
    () => metadata.value?.color || themeColors.value.primary,
)

const heroIsLight = computed(() => isLightColor(heroColor.value))

const router = useRouter()

function goBack() {
    if (window.history.state?.back) router.back()
    else void navigateTo(gymPath('/routes'))
}

const heroStyle = computed(() => {
    const color = heroColor.value
    return {
        background: `linear-gradient(135deg, ${color} 0%, ${shadeColor(color, -30)} 100%)`,
        '--hero-ink': heroIsLight.value ? '#1a1a1a' : '#ffffff',
        '--hero-tint': heroIsLight.value
            ? 'rgba(0, 0, 0, 0.12)'
            : 'rgba(255, 255, 255, 0.2)',
        '--hero-ink-muted': heroIsLight.value
            ? 'rgba(0, 0, 0, 0.72)'
            : 'rgba(255, 255, 255, 0.8)',
        '--hero-shade': heroIsLight.value
            ? 'rgba(255, 255, 255, 0.35)'
            : 'rgba(0, 0, 0, 0.45)',
        '--hero-title-shadow': heroIsLight.value
            ? 'none'
            : '0 1px 3px rgba(0, 0, 0, 0.3)',
    }
})

const { bands: gymBands, bandName } = useGymBands()
const gymBand = computed(() => gymBandFor(metadata.value, gymBands.value))

const difficultyBadgeStyle = computed(() => {
    const color = heroColor.value
    return {
        background: color,
        color: isLightColor(color) ? '#1a1a1a' : '#ffffff',
    }
})

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

const avgRating = computed(() => {
    const rated = reviews.value.filter((r) => (r.rating ?? 0) > 0)
    if (!rated.length) return '—'
    const sum = rated.reduce((acc, r) => acc + (r.rating ?? 0), 0)
    return formatNumber(sum / rated.length, locale.value)
})

const avgPerceivedDifficulty = computed(() => {
    const withDiff = reviews.value.filter((r) => r.difficultyLabel)
    if (!withDiff.length) return null
    const counts: Record<string, number> = {}
    withDiff.forEach((r) => {
        counts[r.difficultyLabel] = (counts[r.difficultyLabel] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
})

// ── Data fetching ──────────────────────────────────────────────────────────

function mapReview(r: RatingRecord): ReviewDisplay {
    const userName = r.author?.name || t('comments.anonymous')
    const userAvatar = r.author
        ? usePbFileUrl(
              { collectionId: '_pb_users_auth_', id: r.author.id },
              r.author.avatar,
              { thumb: '80x80' },
          ) || null
        : null

    return {
        id: r.id,
        rating: typeof r.rating === 'number' ? r.rating : null,
        difficultyLabel: formatGrade(r),
        comment: r.comment ?? null,
        created: r.created ?? '',
        userName,
        userAvatar,
        userId: r.author?.id,
        mine: !!r.mine,
    }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

await Promise.all([routeDetail, routeRatings, routeDefects])

if (routeDetail.error.value)
    throw createError({ status: routeDetail.error.value.status, fatal: true })
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

.comment-card--target {
    outline: 2px solid var(--ui-success);
    outline-offset: 2px;
    animation: target-fade 3s ease-out forwards;
}

@keyframes target-fade {
    0%,
    60% {
        outline-color: var(--ui-success);
    }
    100% {
        outline-color: color-mix(in oklab, var(--ui-success) 0%, transparent);
    }
}

@media (prefers-reduced-motion: reduce) {
    .comment-card--target {
        animation: none;
    }
}

.route-page {
    max-width: 600px;
    margin: 0 auto;
    padding: 0;
}

.route-page__bottom-spacer {
    height: 24px;
}

.route-details {
    padding: 16px 16px 0;
}

.route-hero {
    position: relative;
    min-height: 180px;
    padding: 20px 20px 28px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 8px;
    overflow: hidden;
}

/* Round hero corners on tablet */
@variant sm {
    .route-hero {
        border-radius: 0 0 16px 16px;
    }
}

.route-hero__back {
    position: relative;
    z-index: 1;
    align-self: flex-start;
    margin: -8px 0 auto;
}

.route-hero__overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
        to top,
        var(--hero-shade) 0%,
        rgba(0, 0, 0, 0.05) 60%,
        transparent 100%
    );
    pointer-events: none;
}

.route-hero__content {
    position: relative;
    z-index: 1;
}

.route-hero__chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}

.route-hero__headline {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
}

.route-hero__name {
    min-width: 0;
}

.route-hero__ink,
.route-hero__tint {
    color: var(--hero-ink);
}

.route-hero__tint {
    background: var(--hero-tint);
}

.route-hero__ink-muted {
    color: var(--hero-ink-muted);
}

.route-hero__title {
    line-height: 1.2;
    text-shadow: var(--hero-title-shadow);
}

.route-hero__difficulty-badge {
    position: relative;
    overflow: hidden;
    border: 0;
    cursor: pointer;
    flex-direction: column;
    flex-shrink: 0;
    min-width: 52px;
    height: 52px;
    padding: 0 12px;
    border-radius: 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
}

.route-hero__difficulty-text {
    font-size: 1.25rem;
    line-height: 1;
    white-space: nowrap;
}

.route-hero__difficulty-band {
    position: absolute;
    inset: auto 0 0;
    height: 7px;
    box-shadow: 0 -1px 0 rgba(255, 255, 255, 0.6);
}

.route-hero__difficulty-system {
    font-size: 0.65rem;
    font-weight: 600;
    line-height: 1;
    margin-top: 3px;
    opacity: 0.8;
}

.stats-card {
    position: relative;
    z-index: 2;
    background: var(--ui-bg);
}

@variant lg {
    .route-page {
        max-width: none;
        padding: 16px 16px 0;
    }

    .route-layout {
        display: grid;
        grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
        grid-template-areas:
            'hero hero'
            'details reviews'
            '. reviews';
        grid-template-rows: auto auto 1fr;
        column-gap: 32px;
        align-items: start;
    }

    .route-layout__main {
        display: contents;
    }

    .route-hero {
        grid-area: hero;
        min-height: 220px;
        border-radius: 16px;
        padding: 28px 32px;
        justify-content: center;
    }

    .route-hero__content {
        padding-right: 360px;
    }

    .route-hero__content h1 {
        font-size: 2.5rem;
    }

    .route-hero__headline {
        justify-content: flex-start;
        align-items: center;
        gap: 20px;
    }

    .route-hero__difficulty-badge {
        min-width: 72px;
        height: 72px;
        border-radius: 20px;
    }

    .route-hero__difficulty-text {
        font-size: 1.75rem;
    }

    .stats-card {
        grid-area: hero;
        align-self: center;
        justify-self: end;
        min-width: 320px;
    }

    .route-details {
        grid-area: details;
        padding-top: 24px;
    }

    .route-layout__reviews {
        grid-area: reviews;
        padding-top: 24px;
    }
}

@variant xl {
    .route-reviews-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
        column-gap: 16px;
        align-items: start;
    }
}
</style>
