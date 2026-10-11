<template>
    <div class="comments-page mx-auto w-full p-4">
        <LayoutPageHeader :title="t('routes.comments')" />

        <div class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div
                v-for="tile in statTiles"
                :key="tile.key"
                class="min-w-0 rounded-lg bg-default px-3 py-2 ring ring-default"
                :data-testid="`comments-stat-${tile.key}`"
            >
                <LayoutStatTile
                    :label="tile.label"
                    :value="tile.value"
                    :color="tile.color"
                    :icon="tile.icon"
                    :icon-color="tile.iconColor"
                />
            </div>
        </div>

        <FilterBar
            v-model="search"
            :search-label="t('actions.search')"
            :active-filter-count="activeFilterCount"
            @clear="clearFilters"
        >
            <template #filters>
                <div class="contents">
                    <FilterSelect
                        :label="t('climbing.location')"
                        v-model="selectedLocation"
                        :items="locations"
                        label-key="text"
                        value-key="value"
                        :placeholder="t('filter.all')"
                        clear
                        data-testid="comments-filter-location"
                        @clear="selectedLocation = null"
                    />
                    <FilterSelect
                        :label="t('climbing.difficulty')"
                        v-model="selectedDifficulty"
                        :items="difficulties"
                        label-key="text"
                        value-key="value"
                        :placeholder="t('filter.all')"
                        clear
                        data-testid="comments-filter-difficulty"
                        @clear="selectedDifficulty = null"
                    />
                    <div class="w-full sm:w-56">
                        <USelect
                            v-model="sortOrder"
                            :items="sortOptions"
                            icon="i-lucide-arrow-up-down"
                            :aria-label="t('table.sort_by')"
                            class="w-full"
                            data-testid="comments-sort"
                        />
                    </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <SegmentedControl
                        v-model="ratingTab"
                        :items="ratingOptions"
                        test-id="comments-filter-rating"
                    />
                    <SegmentedControl
                        v-model="dateTab"
                        :items="dateOptions"
                        test-id="comments-filter-date"
                    />
                </div>
            </template>
        </FilterBar>

        <LayoutLoadingState
            v-if="loading && !comments.length"
            variant="cards"
        />

        <LayoutEmptyState
            v-else-if="!loading && !comments.length"
            icon="i-lucide-message-square-off"
            :title="t('comments.noComments')"
            :hint="t('comments.noCommentsHint')"
        />

        <div v-else class="grid grid-cols-12 gap-4">
            <div
                v-for="comment in comments"
                :key="comment.id"
                class="col-span-12 sm:col-span-6 lg:col-span-4"
            >
                <VirtualWindow :estimated-height="240">
                    <CommentsCard :comment="comment" show-route>
                        <template #actions>
                            <UTooltip :text="t('actions.edit')">
                                <UButton
                                    class="icon-btn"
                                    icon="i-lucide-pencil"
                                    color="neutral"
                                    variant="ghost"
                                    :aria-label="t('actions.edit')"
                                    data-testid="comment-card-edit"
                                    @click="openEdit(comment)"
                                />
                            </UTooltip>
                            <UTooltip :text="t('moderation.moderate')">
                                <UButton
                                    class="icon-btn"
                                    icon="i-lucide-shield-check"
                                    color="neutral"
                                    variant="ghost"
                                    :aria-label="t('moderation.moderate')"
                                    data-testid="comment-card-moderate"
                                    @click="moderate(comment)"
                                />
                            </UTooltip>
                        </template>
                    </CommentsCard>
                </VirtualWindow>
            </div>
        </div>

        <div v-if="!loading && comments.length" class="text-center mt-4">
            <p class="text-xs text-muted mb-3" data-testid="comments-showing">
                {{
                    t('comments.showing', {
                        n: comments.length,
                        total: totalItems,
                    })
                }}
            </p>
            <div ref="sentinelRef" class="load-sentinel">
                <LayoutLoadingState v-if="loadingMore" :count="1" />
            </div>
        </div>

        <ReviewFormDialog
            v-model="editDialog"
            :review="editingReview"
            @saved="onReviewSaved"
        />
    </div>
</template>

<script setup lang="ts">
import {
    getRatingStats,
    listGymRatings,
    type RatingQuery,
    type RatingSort,
} from '~/api/ratings'
import { isAbortError } from '~/utils/errors'
import { openCase } from '~/api/moderation'
import { pbDateString } from '~/utils/audit'
import { realtimeCommentPlacement } from '~/utils/comments'
import { gymChangesTopic, type GymChange } from '~/utils/realtimeCache'
import { formatNumber } from '#shared/utils/number'
import { locationName } from '#shared/utils/formatting'
import { formatGrade } from '#shared/utils/grades'
import type { RatingRecord, RouteRecord } from '~/types/models'

type ManagedComment = RatingRecord & {
    created: string
    routeId: string | null
    routeName: string
    location: string | null
    difficultyLabel: string | null
    userName: string
    userAvatar: string | null
}

const { t, locale } = useI18n()
const gymPath = useGymPath()
const gymId = useCurrentGymId()

useHead({
    title: t('page.title.comments'),
    meta: [{ name: 'description', content: t('page.content.comments') }],
})

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_comments',
})

// ── State ──────────────────────────────────────────────────────────────────

const {
    items: comments,
    totalItems,
    loading,
    loadingMore,
    hasMore,
    refresh: fetchList,
    loadMore: loadNextPage,
    prefetch,
} = usePbList<RatingRecord, ManagedComment>(
    (page, limit) =>
        listGymRatings(gymId.value, {
            ...buildQuery(),
            page,
            limit,
            total: true,
        }),
    { perPage: 48, requestKey: 'commentsList', map: mapComment },
)

const stats = ref({ totalReviews: 0, avgRating: '—', thisWeek: 0, lowRated: 0 })
const statTiles = computed(() => [
    {
        key: 'total',
        label: t('comments.totalReviews'),
        value: stats.value.totalReviews,
        color: 'primary',
    },
    {
        key: 'avg-rating',
        label: t('comments.avgRating'),
        value: stats.value.avgRating,
        color: 'warning',
        icon: 'i-lucide-star',
        iconColor: 'amber-500',
    },
    {
        key: 'this-week',
        label: t('comments.thisWeek'),
        value: stats.value.thisWeek,
        color: 'success',
    },
    {
        key: 'low-rated',
        label: t('comments.lowRated'),
        value: stats.value.lowRated,
        color: 'error',
    },
])

const pageRoute = useRoute()
const search = ref(String(pageRoute.query.search ?? ''))
watch(
    () => pageRoute.query.search,
    (value) => (search.value = String(value ?? '')),
)
const selectedLocation = ref<string | null>(null)
const selectedDifficulty = ref<string | null>(null)
const selectedRating = ref(0)
const dateFilter = ref('')
const sortOrder = ref('newest')

const editDialog = ref(false)
const editingReview = ref<ManagedComment | null>(null)

const { notify } = useNotification()

const activeFilterCount = computed(
    () =>
        [selectedLocation.value, selectedDifficulty.value].filter(Boolean)
            .length +
        (selectedRating.value !== 0 ? 1 : 0) +
        (dateFilter.value ? 1 : 0),
)

function clearFilters() {
    selectedLocation.value = null
    selectedDifficulty.value = null
    selectedRating.value = 0
    dateFilter.value = ''
    sortOrder.value = 'newest'
}

// ── Static options ─────────────────────────────────────────────────────────

const { gradeFilterItems } = useGradeSystems()

const difficulties = gradeFilterItems

const { data: locationRecords } = useLocations()

const locations = computed(() =>
    (locationRecords.value ?? []).map((location) => ({
        text: location.name,
        value: location.id,
    })),
)

const dateOptions = computed(() => [
    { label: t('filter.all'), value: 'all' },
    { label: t('comments.thisWeek'), value: 'week' },
    { label: t('comments.thisMonth'), value: 'month' },
])
const dateTab = computed({
    get: () => dateFilter.value || 'all',
    set: (value: string) => {
        dateFilter.value = value === 'all' ? '' : value
    },
})

const ratingOptions = computed(() => [
    { label: t('filter.all'), value: 'all' },
    ...[1, 2, 3, 4, 5].map((star) => ({
        label: `${star}★`,
        value: String(star),
    })),
])
const ratingTab = computed({
    get: () => (selectedRating.value ? String(selectedRating.value) : 'all'),
    set: (value: string) => {
        selectedRating.value = value === 'all' ? 0 : Number(value)
    },
})

const sortOptions = computed(() => [
    { label: t('comments.sortNewest'), value: 'newest' },
    { label: t('comments.sortOldest'), value: 'oldest' },
    { label: t('comments.sortHighest'), value: 'highest' },
    { label: t('comments.sortLowest'), value: 'lowest' },
])

// ── Query builders ─────────────────────────────────────────────────────────

function buildQuery(): RatingQuery {
    const difficulty = selectedDifficulty.value ?? ''
    const separator = difficulty.indexOf(':')
    const days = ({ week: 7, month: 30 } as Record<string, number>)[
        dateFilter.value
    ]
    return {
        q: search.value.trim() || undefined,
        rating: selectedRating.value || undefined,
        location: selectedLocation.value || undefined,
        grade_system: difficulty.slice(0, Math.max(separator, 0)) || undefined,
        grade: difficulty.slice(separator + 1) || undefined,
        since: days
            ? pbDateString(new Date(Date.now() - days * 86_400_000))
            : undefined,
        sort: sortOrder.value as RatingSort,
    }
}

// ── Data fetching ──────────────────────────────────────────────────────────

function mapComment(rating: RatingRecord): ManagedComment {
    const route = rating.expand?.route_id as RouteRecord | undefined
    return {
        ...rating,
        created: rating.created ?? '',
        routeId: route?.id ?? null,
        routeName: route?.name ?? 'N/A',
        location: locationName(route) || null,
        difficultyLabel: formatGrade(rating) || null,
        userName: rating.author?.name || t('comments.anonymous'),
        userAvatar: rating.author?.avatar || null,
    }
}

const fetchStats = async () => {
    try {
        const rec = await getRatingStats(gymId.value)
        stats.value = {
            totalReviews: rec.total_reviews,
            avgRating:
                rec.avg_rating != null
                    ? formatNumber(rec.avg_rating, locale.value)
                    : '—',
            thisWeek: rec.this_week,
            lowRated: rec.low_rated,
        }
    } catch (err) {
        if (isAbortError(err)) return
    }
}

let statsDebounce: ReturnType<typeof setTimeout> | undefined
function scheduleStatsRefresh() {
    clearTimeout(statsDebounce)
    statsDebounce = setTimeout(() => fetchStats(), 500)
}

async function loadMore() {
    if (loading.value || loadingMore.value || !hasMore.value) return
    await loadNextPage()
    await nextTick()
    if (sentinelRef.value && scrollObserver) {
        scrollObserver.unobserve(sentinelRef.value)
        scrollObserver.observe(sentinelRef.value)
    }
}

// ── Infinite scroll ────────────────────────────────────────────────────────

const sentinelRef = ref<HTMLElement | null>(null)
let scrollObserver: IntersectionObserver | null = null

watch(sentinelRef, (el) => {
    scrollObserver?.disconnect()
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (!scrollObserver) {
        scrollObserver = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) loadMore()
            },
            { rootMargin: '400px 0px' },
        )
    }
    scrollObserver.observe(el)
})

// ── Watchers ───────────────────────────────────────────────────────────────

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
    clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => fetchList(), 300)
})

watch(
    [
        selectedLocation,
        selectedDifficulty,
        selectedRating,
        dateFilter,
        sortOrder,
    ],
    () => {
        fetchList()
    },
)

// ── Edit ───────────────────────────────────────────────────────────────────

function openEdit(comment: ManagedComment) {
    editingReview.value = comment
    editDialog.value = true
}

function onReviewSaved(updated: RatingRecord | null) {
    const idx = updated
        ? comments.value.findIndex((c) => c.id === updated.id)
        : -1
    const existing = comments.value[idx]
    if (updated && existing) {
        comments.value[idx] = mapComment({
            ...updated,
            expand: existing.expand,
        })
    }
    notify(t('notifications.success.edit'))
    scheduleStatsRefresh()
}

const { run: runModerate } = useAsyncAction()

async function moderate(comment: ManagedComment) {
    const opened = await runModerate(() =>
        openCase({ content_type: 'rating', content_id: comment.id }),
    )
    if (opened)
        await navigateTo(gymPath(`/manage/moderation?case=${opened.id}`))
}

function removeComments(ids: string[]) {
    const remaining = comments.value.filter((c) => !ids.includes(c.id))
    const removedCount = comments.value.length - remaining.length
    comments.value = remaining
    totalItems.value = Math.max(0, totalItems.value - removedCount)
}

async function fetchCommentIfVisible(id: string) {
    const result = await listGymRatings(gymId.value, {
        ...buildQuery(),
        ids: [id],
        page: 1,
        limit: 1,
    })
    return result.items[0] ?? null
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

const [, { data: initialStats }] = await Promise.all([
    prefetch('admin-comments'),
    useAsyncData('admin-comments-stats', async () => {
        await fetchStats()
        return stats.value
    }),
])
if (initialStats.value) stats.value = initialStats.value

useRealtime(
    () => gymChangesTopic(gymId.value),
    async (e: GymChange<RatingRecord>) => {
        if (e.collection !== 'ratings') return
        if (e.action === 'delete') {
            removeComments([e.record.id])
            scheduleStatsRefresh()
        } else if (e.action === 'create') {
            scheduleStatsRefresh()
            try {
                const rec = await fetchCommentIfVisible(e.record.id)
                if (!rec) return
                const placement = realtimeCommentPlacement(
                    sortOrder.value,
                    comments.value.some((c) => c.id === rec.id),
                    hasMore.value,
                )
                if (placement === 'prepend') {
                    comments.value = [mapComment(rec), ...comments.value]
                    totalItems.value++
                } else if (placement === 'append') {
                    comments.value = [...comments.value, mapComment(rec)]
                    totalItems.value++
                } else {
                    await fetchList()
                }
            } catch {}
        } else if (e.action === 'update') {
            if (!comments.value.some((c) => c.id === e.record.id)) return
            try {
                const [rec] = (
                    await listGymRatings(gymId.value, {
                        ids: [e.record.id],
                        page: 1,
                        limit: 1,
                    })
                ).items
                const idx = comments.value.findIndex((c) => c.id === rec?.id)
                if (rec && idx !== -1) comments.value[idx] = mapComment(rec)
            } catch {}
            scheduleStatsRefresh()
        }
    },
)

onBeforeUnmount(() => {
    clearTimeout(searchDebounce)
    clearTimeout(statsDebounce)
    scrollObserver?.disconnect()
    scrollObserver = null
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.slide-y-enter-active,
.slide-y-leave-active {
    transition:
        opacity 0.2s,
        transform 0.2s;
}

.slide-y-enter-from,
.slide-y-leave-to {
    opacity: 0;
    transform: translateY(-8px);
}

.load-sentinel {
    min-height: 32px;
}

.bulk-bar {
    border-top: 1px solid
        color-mix(in oklab, var(--ui-text-highlighted) 12%, transparent);
    background: color-mix(in oklab, var(--ui-primary) 5%, transparent);
    border-radius: 0 0 8px 8px;
}
</style>
