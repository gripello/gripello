<template>
    <div class="comments-page mx-auto w-full p-4">
        <LayoutPageHeader :title="t('routes.comments')" />

        <div class="stats-scroll mb-3">
            <div class="stats-scroll__inner">
                <div
                    v-for="tile in statTiles"
                    :key="tile.key"
                    class="stat-chip rounded-lg border bg-default p-2 px-3"
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
                    <div class="flex flex-wrap gap-2">
                        <UButton
                            size="xs"
                            :color="
                                selectedRating === 0 ? 'warning' : 'neutral'
                            "
                            variant="soft"
                            :icon="
                                selectedRating === 0
                                    ? 'i-lucide-check'
                                    : undefined
                            "
                            :aria-pressed="selectedRating === 0"
                            data-testid="comments-filter-rating-all"
                            @click="selectedRating = 0"
                        >
                            {{ t('filter.all') }}
                        </UButton>
                        <UButton
                            v-for="star in [1, 2, 3, 4, 5]"
                            :key="star"
                            size="xs"
                            color="warning"
                            :variant="
                                selectedRating === star ? 'solid' : 'soft'
                            "
                            :icon="
                                selectedRating === star
                                    ? 'i-lucide-check'
                                    : undefined
                            "
                            :aria-pressed="selectedRating === star"
                            :data-testid="`comments-filter-rating-${star}`"
                            @click="selectedRating = star"
                        >
                            {{ star }}★
                        </UButton>
                    </div>
                    <UFieldGroup data-testid="comments-filter-date">
                        <UButton
                            v-for="option in dateOptions"
                            :key="option.value"
                            size="sm"
                            color="neutral"
                            :variant="
                                dateFilter === option.value
                                    ? 'solid'
                                    : 'outline'
                            "
                            :aria-pressed="dateFilter === option.value"
                            @click="dateFilter = option.value"
                        >
                            {{ option.label }}
                        </UButton>
                    </UFieldGroup>
                </div>
            </template>

            <template #below>
                <Transition name="slide-y">
                    <div
                        v-if="selectedCount > 0"
                        class="bulk-bar px-4 py-2 flex items-center gap-2 flex-wrap"
                    >
                        <UIcon
                            name="i-lucide-circle-check"
                            class="size-[18px] text-primary"
                        />
                        <span class="text-sm font-medium">
                            {{ t('comments.selected', { n: selectedCount }) }}
                        </span>
                        <div class="flex-1" />
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="ghost"
                            data-testid="comments-bulk-cancel"
                            @click="clearSelection"
                        >
                            {{ t('actions.cancel') }}
                        </UButton>
                        <UButton
                            size="sm"
                            color="error"
                            variant="soft"
                            icon="i-lucide-trash-2"
                            data-testid="comments-bulk-delete"
                            @click="bulkDeleteDialog = true"
                        >
                            {{
                                t('comments.deleteSelected', {
                                    n: selectedCount,
                                })
                            }}
                        </UButton>
                    </div>
                </Transition>
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
                    <CommentsCard
                        :comment="comment"
                        selectable
                        :selected="!!selectedMap[comment.id]"
                        show-route
                        @toggle-select="toggleSelect(comment.id)"
                    >
                        <template #actions>
                            <UTooltip :text="t('actions.edit')">
                                <UButton
                                    icon="i-lucide-pencil"
                                    color="neutral"
                                    variant="ghost"
                                    :aria-label="t('actions.edit')"
                                    data-testid="comment-card-edit"
                                    @click="openEdit(comment)"
                                />
                            </UTooltip>
                            <UButton
                                icon="i-lucide-trash-2"
                                color="error"
                                variant="ghost"
                                :aria-label="t('actions.delete')"
                                data-testid="comment-card-delete"
                                @click="openDelete(comment)"
                            />
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
                <UIcon
                    v-if="loadingMore"
                    name="i-lucide-loader-circle"
                    class="size-6 animate-spin text-primary"
                />
            </div>
        </div>

        <ReviewFormDialog
            v-model="editDialog"
            :review="editingReview"
            @saved="onReviewSaved"
        />

        <ConfirmDialog
            v-model="deleteDialog"
            :title="t('actions.confirm')"
            :message="t('notifications.deleteItem')"
            :loading="deleting"
            @confirm="confirmDelete"
        />

        <ConfirmDialog
            v-model="bulkDeleteDialog"
            :title="
                t(
                    'comments.bulkDeleteTitle',
                    { n: selectedCount },
                    selectedCount,
                )
            "
            :message="t('notifications.deleteMoreItems')"
            :loading="bulkDeleting"
            @confirm="bulkDelete"
        />
    </div>
</template>

<script setup lang="ts">
import { isAbortError } from '~/utils/errors'
import { pbDateString } from '~/utils/audit'
import { sendInBatches } from '~/utils/batch'
import { realtimeCommentPlacement } from '~/utils/comments'
import { formatNumber } from '#shared/utils/number'
import { locationName } from '#shared/utils/formatting'
import { formatGrade } from '#shared/utils/grades'
import type { RatingRecord, RouteRecord, UserRecord } from '~/types/models'

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
const pb = usePocketbase()
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

const { pending: bulkDeleting, run: runBulkDelete } = useAsyncAction()

const {
    items: comments,
    totalItems,
    loading,
    loadingMore,
    hasMore,
    refresh: fetchList,
    loadMore: loadNextPage,
    prefetch,
} = usePbList<RatingRecord, ManagedComment>('ratings', {
    perPage: 48,
    requestKey: 'commentsList',
    query: () => ({
        sort: buildSort(),
        filter: buildFilter(search.value.trim()),
        expand: 'route_id.location,user',
        fields: LIST_FIELDS,
    }),
    map: mapComment,
})

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

const selectedMap = reactive<Record<string, true>>({})
const selectedCount = computed(() => Object.keys(selectedMap).length)

const editDialog = ref(false)
const editingReview = ref<ManagedComment | null>(null)

const bulkDeleteDialog = ref(false)

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

const { gradeFilterItems, gradeFilterClause } = useGradeSystems()

const difficulties = gradeFilterItems

const { data: locationRecords } = useLocations()

const locations = computed(() =>
    (locationRecords.value ?? []).map((location) => ({
        text: location.name,
        value: location.id,
    })),
)

const dateOptions = computed(() => [
    { label: t('filter.all'), value: '' },
    { label: t('comments.thisWeek'), value: 'week' },
    { label: t('comments.thisMonth'), value: 'month' },
])

const sortOptions = computed(() => [
    { label: t('comments.sortNewest'), value: 'newest' },
    { label: t('comments.sortOldest'), value: 'oldest' },
    { label: t('comments.sortHighest'), value: 'highest' },
    { label: t('comments.sortLowest'), value: 'lowest' },
])

// ── Query builders ─────────────────────────────────────────────────────────

function buildFilter(searchTerm: string) {
    const parts = [gymFilter(pb, gymId.value)]
    if (selectedRating.value !== 0)
        parts.push(`rating = ${selectedRating.value}`)
    if (selectedLocation.value)
        parts.push(`route_id.location = "${selectedLocation.value}"`)
    if (selectedDifficulty.value !== null)
        parts.push(gradeFilterClause(selectedDifficulty.value))
    const days = ({ week: 7, month: 30 } as Record<string, number>)[
        dateFilter.value
    ]
    if (days) {
        const cutoff = pbDateString(new Date(Date.now() - days * 86_400_000))
        parts.push(`created >= "${cutoff}"`)
    }
    if (searchTerm) {
        const s = searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        parts.push(`(comment ~ "${s}" || route_id.name ~ "${s}")`)
    }
    return parts.join(' && ')
}

function buildSort() {
    switch (sortOrder.value) {
        case 'oldest':
            return '+created'
        case 'highest':
            return '-rating'
        case 'lowest':
            return '+rating'
        default:
            return '-created'
    }
}

// ── Data fetching ──────────────────────────────────────────────────────────

const LIST_FIELDS = [
    '*',
    'expand.route_id.id',
    'expand.route_id.name',
    'expand.route_id.expand.location.name',
    'expand.user.id',
    'expand.user.collectionId',
    'expand.user.name',
    'expand.user.username',
    'expand.user.avatar',
].join(',')

function mapComment(rating: RatingRecord): ManagedComment {
    const route = rating.expand?.route_id as RouteRecord | undefined
    const user = rating.expand?.user as UserRecord | undefined
    return {
        ...rating,
        created: rating.created ?? '',
        routeId: route?.id ?? null,
        routeName: route?.name ?? 'N/A',
        location: locationName(route) || null,
        difficultyLabel: formatGrade(rating) || null,
        userName: user?.name || user?.username || t('comments.anonymous'),
        userAvatar:
            usePbFileUrl(user, user?.avatar, { thumb: '100x100' }) || null,
    }
}

const fetchStats = async () => {
    try {
        const result = await pb.collection('ratingsStats').getList(1, 1, {
            filter: pb.filter('gym = {:gym}', { gym: gymId.value }),
            skipTotal: true,
            requestKey: 'commentsStats',
        })
        const rec = result.items[0]
        if (!rec) return
        stats.value = {
            totalReviews: Number(rec.totalReviews) || 0,
            avgRating:
                rec.avgRating != null
                    ? formatNumber(Number(rec.avgRating), locale.value)
                    : '—',
            thisWeek: Number(rec.thisWeek) || 0,
            lowRated: Number(rec.lowRated) || 0,
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
    clearSelection()
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
        clearSelection()
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

// ── Single delete (one shared ConfirmDialog for all cards) ─────────────────

const deleteDialog = ref(false)
const { pending: deleting, run: runDelete } = useAsyncAction()
const deleteTarget = ref<ManagedComment | null>(null)

function openDelete(comment: ManagedComment) {
    deleteTarget.value = comment
    deleteDialog.value = true
}

async function confirmDelete() {
    if (!deleteTarget.value) return
    const id = deleteTarget.value.id
    await runDelete(
        async () => {
            await pb.collection('ratings').delete(id)
            removeComments([id])
            deleteDialog.value = false
            deleteTarget.value = null
            scheduleStatsRefresh()
        },
        { success: t('notifications.success.delete') },
    )
}

// ── Bulk delete ────────────────────────────────────────────────────────────

async function bulkDelete() {
    const ids = Object.keys(selectedMap)
    await runBulkDelete(
        async () => {
            const deletedIds: string[] = []
            try {
                await sendInBatches(
                    pb,
                    ids,
                    (batch, id) => batch.collection('ratings').delete(id),
                    (chunk) => deletedIds.push(...chunk),
                )
                bulkDeleteDialog.value = false
            } finally {
                if (deletedIds.length) {
                    removeComments(deletedIds)
                    scheduleStatsRefresh()
                }
            }
        },
        { success: t('notifications.success.delete') },
    )
}

function removeComments(ids: string[]) {
    ids.forEach((id) => delete selectedMap[id])
    const remaining = comments.value.filter((c) => !ids.includes(c.id))
    const removedCount = comments.value.length - remaining.length
    comments.value = remaining
    totalItems.value = Math.max(0, totalItems.value - removedCount)
}

async function fetchCommentIfVisible(id: string) {
    const filter = buildFilter(search.value.trim())
    const idClause = pb.filter('id = {:id}', { id })
    const result = await pb.collection('ratings').getList<RatingRecord>(1, 1, {
        filter: `${idClause} && (${filter})`,
        expand: 'route_id.location,user',
        fields: LIST_FIELDS,
        skipTotal: true,
        requestKey: null,
    })
    return result.items[0] ?? null
}

// ── Selection helpers ──────────────────────────────────────────────────────

function toggleSelect(id: string) {
    if (selectedMap[id]) delete selectedMap[id]
    else selectedMap[id] = true
}

function clearSelection() {
    Object.keys(selectedMap).forEach((k) => delete selectedMap[k])
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

const { subscribe } = usePbSubscription()

const [, { data: initialStats }] = await Promise.all([
    prefetch('admin-comments'),
    useAsyncData('admin-comments-stats', async () => {
        await fetchStats()
        return stats.value
    }),
])
if (initialStats.value) stats.value = initialStats.value

onMounted(async () => {
    await subscribe('ratings', async (e) => {
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
                const rec = await pb
                    .collection('ratings')
                    .getOne<RatingRecord>(e.record.id, {
                        expand: 'route_id.location,user',
                        fields: LIST_FIELDS,
                        requestKey: null,
                    })
                const idx = comments.value.findIndex((c) => c.id === rec.id)
                if (idx !== -1) comments.value[idx] = mapComment(rec)
            } catch {}
            scheduleStatsRefresh()
        }
    })
})

onBeforeUnmount(() => {
    clearTimeout(searchDebounce)
    clearTimeout(statsDebounce)
    scrollObserver?.disconnect()
    scrollObserver = null
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.stats-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
}

.stats-scroll::-webkit-scrollbar {
    display: none;
}

.stats-scroll__inner {
    display: flex;
    gap: 8px;
}

.stat-chip {
    flex: 1 0 auto;
    min-width: 100px;
}

@variant sm {
    .stat-chip {
        flex: 1 1 0;
        min-width: 0;
    }
}

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
