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

        <LayoutLoadError
            v-else-if="loadError && !comments.length"
            @retry="fetchList"
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
                            <UButton
                                icon="i-lucide-pencil"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                data-testid="comment-card-edit"
                                @click="openEdit(comment)"
                            >
                                {{ t('actions.edit') }}
                            </UButton>
                            <UButton
                                icon="i-lucide-shield-check"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                data-testid="comment-card-moderate"
                                @click="moderate(comment)"
                            >
                                {{ t('moderation.moderate') }}
                            </UButton>
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
import { gymChangesTopic } from '#shared/utils/topics'
import { useIntersectionObserver, useTimeoutFn } from '@vueuse/core'
import {
    getRatingStats,
    listGymRatings,
    type RatingQuery,
    type RatingSort,
} from '~/api/ratings'
import { isAbortError } from '~/utils/errors'
import { openModerationCase } from '~/api/moderation'
import { realtimeCommentPlacement } from '~/utils/comments'
import { coalesceIds, type GymChange } from '~/utils/realtimeCache'
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
    error: loadError,
    refresh: fetchList,
    loadMore: loadNextPage,
    prefetch,
} = useList<RatingRecord, ManagedComment>(
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
        color: 'primary' as const,
    },
    {
        key: 'avg-rating',
        label: t('comments.avgRating'),
        value: stats.value.avgRating,
        color: 'warning' as const,
        icon: 'i-lucide-star',
        iconColor: 'warning' as const,
    },
    {
        key: 'this-week',
        label: t('comments.thisWeek'),
        value: stats.value.thisWeek,
        color: 'success' as const,
    },
    {
        key: 'low-rated',
        label: t('comments.lowRated'),
        value: stats.value.lowRated,
        color: 'error' as const,
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

const { items: locations } = useLocations()

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
        since: days ? new Date(Date.now() - days * 86_400_000) : undefined,
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

const { start: scheduleStatsRefresh } = useTimeoutFn(() => fetchStats(), 500, {
    immediate: false,
})

async function loadMore() {
    if (loading.value || loadingMore.value || !hasMore.value) return
    await loadNextPage()
    await nextTick()
    pauseScrollObserver()
    resumeScrollObserver()
}

// ── Infinite scroll ────────────────────────────────────────────────────────

const sentinelRef = ref<HTMLElement | null>(null)
const { pause: pauseScrollObserver, resume: resumeScrollObserver } =
    useIntersectionObserver(
        sentinelRef,
        ([entry]) => {
            if (entry?.isIntersecting) loadMore()
        },
        { rootMargin: '400px 0px' },
    )

// ── Watchers ───────────────────────────────────────────────────────────────

const { start: fetchListSoon } = useTimeoutFn(() => fetchList(), 300, {
    immediate: false,
})
watch(search, () => fetchListSoon())

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
        openModerationCase({ content_type: 'rating', content_id: comment.id }),
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

// ── Lifecycle ──────────────────────────────────────────────────────────────

const [, { data: initialStats }] = await Promise.all([
    prefetch('admin-comments'),
    useAsyncData('admin-comments-stats', async () => {
        await fetchStats()
        return stats.value
    }),
])
if (initialStats.value) stats.value = initialStats.value

// one request per burst: the changed ids that still match the filters come back, the others leave the list
const refreshCommentsSoon = coalesceIds(async (ids) => {
    if (!ids) return fetchList()
    const { items } = await listGymRatings(gymId.value, {
        ...buildQuery(),
        ids: [...ids],
        page: 1,
        limit: ids.size,
    })
    const found = new Map(items.map((rec) => [rec.id, rec]))
    removeComments(
        [...ids].filter(
            (id) => !found.has(id) && comments.value.some((c) => c.id === id),
        ),
    )
    for (const rec of found.values()) {
        const index = comments.value.findIndex((c) => c.id === rec.id)
        if (index !== -1) {
            comments.value[index] = mapComment(rec)
            continue
        }
        const placement = realtimeCommentPlacement(
            sortOrder.value,
            false,
            hasMore.value,
        )
        if (placement === 'refetch') return fetchList()
        comments.value =
            placement === 'prepend'
                ? [mapComment(rec), ...comments.value]
                : [...comments.value, mapComment(rec)]
        totalItems.value++
    }
}, 500)

useRealtime(
    () => gymChangesTopic(gymId.value),
    (e: GymChange<RatingRecord>) => {
        if (e.collection !== 'ratings') return
        scheduleStatsRefresh()
        if (e.action === 'delete') removeComments([e.record.id])
        else refreshCommentsSoon(e.record.id)
    },
    { resync: () => refreshCommentsSoon() },
)
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
