<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader :title="$t('page.content.index')" inline-actions>
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-sparkles"
                    :aria-label="$t('tasks.wish.action')"
                    :title="$t('tasks.wish.action')"
                    data-testid="index-wish-open"
                    square
                    class="sm:px-2.5"
                    @click="wishDialog = true"
                >
                    <span class="hidden sm:inline">{{
                        $t('tasks.wish.action')
                    }}</span>
                </UButton>
                <GradeConversionDialog>
                    <template #activator="{ props: activator }">
                        <UButton
                            v-bind="activator"
                            color="neutral"
                            variant="soft"
                            icon="i-lucide-arrow-left-right"
                            :aria-label="$t('gradeConversion.title')"
                            :title="$t('gradeConversion.title')"
                            data-testid="index-grade-conversion-open"
                            square
                            class="sm:px-2.5"
                        >
                            <span class="hidden sm:inline">{{
                                $t('gradeConversion.title')
                            }}</span>
                        </UButton>
                    </template>
                </GradeConversionDialog>
            </template>
        </LayoutPageHeader>

        <FilterBar
            v-model="searchRouteName"
            :search-label="$t('climbing.searchRouteName')"
            :search-placeholder="$t('climbing.searchRouteHint')"
            :active-filter-count="activeFilterCount"
            @clear="clearFilters"
        >
            <template #filters>
                <div class="contents">
                    <RouteSortControl
                        v-if="!isWideLayout"
                        :model-value="tableOptions.sortBy"
                        :items="sortItemsMobile"
                        class="self-end"
                        @update:model-value="onMobileSortChange"
                    />
                    <RouteFilterSelects
                        :filters="filters"
                        test-id-prefix="index"
                        with-wall
                    />
                </div>
            </template>
        </FilterBar>

        <LayoutLoadError v-if="loadFailed" class="mt-4" @retry="retryLoad" />

        <div v-else-if="isWideLayout" class="mt-4" data-testid="index-table">
            <UTable
                :data="routes"
                :get-row-id="(row: RouteListItem) => row.id"
                :columns="columnsDesktop"
                :loading="loading"
                :ui="tableUi"
            >
                <template #empty>
                    <LayoutEmptyState :title="$t('table.no_data')">
                        <template #actions>
                            <UButton
                                color="primary"
                                variant="soft"
                                icon="i-lucide-sparkles"
                                data-testid="index-empty-wish"
                                @click="wishDialog = true"
                                >{{ $t('tasks.wish.action') }}</UButton
                            >
                        </template>
                    </LayoutEmptyState>
                </template>
                <template #color-cell="{ row }">
                    <RouteColorDot
                        :color="row.original.color"
                        :ticked="tickedRouteIds.has(row.original.id)"
                        :size="30"
                    />
                </template>
                <template #name-cell="{ row }">
                    <div
                        class="flex max-w-[200px] items-center"
                        :data-testid="`index-row-${row.original.id}`"
                    >
                        <span
                            class="route-name"
                            :title="row.original.name"
                            data-testid="index-row-name"
                            >{{ row.original.name }}</span
                        >
                        <TaskDefectMarker
                            :severity="defectsByRoute.get(row.original.id)"
                            class="ml-2 shrink-0"
                        />
                        <RouteRatedMarker
                            v-if="row.original.has_ratings"
                            class="ml-2 shrink-0"
                        />
                        <UTooltip
                            v-if="row.original.removal_planned_for"
                            :text="outSoonLabel(row.original)"
                        >
                            <UIcon
                                name="i-lucide-calendar-clock"
                                role="img"
                                :aria-label="outSoonLabel(row.original)"
                                class="ml-2 shrink-0 text-warning"
                                data-testid="index-row-out-soon"
                            />
                        </UTooltip>
                    </div>
                </template>
                <template #difficulty-cell="{ row }">
                    <GradeLabel :source="row.original" />
                </template>
                <template #anchor_point-cell="{ row }">
                    <span
                        v-if="
                            hasAnchorPoint(row.original.anchor_point) ||
                            !wallName(row.original)
                        "
                        >{{
                            formatAnchorPoint(row.original.anchor_point)
                        }}</span
                    >
                    <span
                        v-if="wallName(row.original)"
                        class="route-wall"
                        data-testid="index-row-wall"
                        >{{ wallName(row.original) }}</span
                    >
                </template>
                <template #comment-cell="{ row }">
                    <div
                        class="route-comment"
                        :title="row.original.comment ?? undefined"
                    >
                        {{ row.original.comment }}
                    </div>
                </template>
                <template #creator-cell="{ row }">
                    <RouteCreators
                        :creators="row.original.creator ?? []"
                        data-testid="index-row-creators"
                    />
                </template>
                <template #score-cell="{ row }">
                    {{ formatScore(row.original, locale) }}
                </template>
                <template #screw_date-cell="{ row }">
                    {{ formatDate(row.original.screw_date, { locale }) }}
                </template>
                <template #actions-cell="{ row }">
                    <div class="flex items-center gap-2 justify-end">
                        <RouteViewButton :route-id="row.original.id" compact />
                        <RouteDetails :route_id="row.original.id" compact />
                    </div>
                </template>
            </UTable>
            <div
                class="flex flex-wrap items-center justify-end gap-4 px-2 py-3 text-sm"
            >
                <span data-testid="table-page-info">{{ pageInfo }}</span>
                <UPagination
                    :page="tableOptions.page"
                    :total="totalItems"
                    :items-per-page="tableOptions.itemsPerPage"
                    @update:page="loadRoutes({ page: $event })"
                />
            </div>
        </div>

        <div v-if="!isWideLayout && !loadFailed">
            <div class="mt-2 flex flex-col gap-4">
                <RouteCard
                    v-for="route in routes"
                    :key="route.id"
                    :route="route"
                    :ticked="tickedRouteIds.has(route.id)"
                    :defect="defectsByRoute.get(route.id)"
                >
                    <template #actions>
                        <div class="flex items-center gap-2 justify-end">
                            <RouteViewButton :route-id="route.id" />
                            <RouteDetails :route_id="route.id" />
                        </div>
                    </template>
                </RouteCard>
            </div>

            <div ref="sentinelRef" class="p-4 text-center">
                <UIcon
                    v-if="loading && routes.length > 0"
                    name="i-lucide-loader-circle"
                    class="size-6 animate-spin text-primary"
                />
            </div>
        </div>

        <LayoutLoadingState
            v-if="
                !loadFailed && loading && routes.length === 0 && !isWideLayout
            "
            type="card"
            :count="1"
            class="mt-4"
        />
        <LayoutEmptyState
            v-if="
                !loadFailed && !loading && routes.length === 0 && !isWideLayout
            "
            class="mt-4"
            :title="$t('table.no_data')"
        >
            <template #actions>
                <UButton
                    color="primary"
                    variant="soft"
                    icon="i-lucide-sparkles"
                    data-testid="index-empty-wish"
                    @click="wishDialog = true"
                    >{{ $t('tasks.wish.action') }}</UButton
                >
            </template>
        </LayoutEmptyState>

        <TaskWishDialog
            v-model="wishDialog"
            :location-id="selectedLocation"
            :wall-id="selectedWall"
            :route-type="selectedType"
            :grade="selectedDifficulty?.split(':')[1]"
        />
    </div>
</template>

<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { listRoutes } from '~/api/routes'
import { isAbortError } from '~/utils/errors'
import type { TableColumn } from '@nuxt/ui'
import type { RouteListItem, RouteRecord } from '~/types/models'
import {
    latestRequestTracker,
    toRouteRow,
    type RouteTableLoad,
} from '~/composables/useRouteTable'
import {
    formatAnchorPoint,
    formatScore,
    hasAnchorPoint,
    formatDate,
    wallName,
} from '#shared/utils/formatting'
import {
    cacheKeys,
    unlessQueryChanged,
    type ListPage,
} from '~/utils/realtimeCache'

const { t, locale } = useI18n()
const { gym } = useGym()
const outSoonLabel = (route: { removal_planned_for?: string | null }) =>
    t('routes.outSoon', {
        date: formatDate(route.removal_planned_for, { locale: locale.value }),
    })
const gymId = useCurrentGymId()
const { lgAndUp } = useDisplay()

const isWideLayout = computed(() => lgAndUp.value)
const wishDialog = ref(false)
const { error: notifyError } = useNotification()
const { polite: announce } = useAnnouncer()

const filters = useRouteFilters('routes')
const {
    searchRouteName,
    selectedDifficulty,
    selectedType,
    selectedLocation,
    selectedWall,
    activeFilterCount,
    routeQuery: baseQuery,
    clearFilters,
} = filters

useSeoMeta({
    title: () => t('page.title.index'),
    description: () => t('seo.routes', { name: gym.value?.name ?? '' }),
    ogTitle: () => t('page.title.index'),
    ogDescription: () => t('seo.routes', { name: gym.value?.name ?? '' }),
    ogType: 'website',
})

definePageMeta({ keepalive: true })

const loading = ref(true)
const { tickedRouteIds } = useTickedRoutes()
const { defectsByRoute } = useOpenDefects()
const sentinelRef = useTemplateRef<HTMLElement>('sentinelRef')

const { gradeColumnTitle } = useGradeSystems()

const routeQueryKey = computed(() =>
    JSON.stringify([gymId.value, baseQuery.value]),
)
const {
    tableOptions,
    tableUi,
    sortableHeader,
    pageInfo,
    sortItemsMobile,
    onMobileSortChange,
    routeSort,
} = useRouteTable({
    itemsPerPage: 20,
    totalItems: computed(() => routePage.value.totalItems),
    queryKey: routeQueryKey,
    defaultSort: '-screw_date',
    load: (options) => loadRoutes(options),
})

const columnsDesktop = computed<TableColumn<RouteListItem>[]>(() => [
    { id: 'color', header: t('climbing.color') },
    { id: 'name', header: sortableHeader(t('climbing.routename'), 'name') },
    {
        id: 'difficulty',
        header: sortableHeader(gradeColumnTitle.value, 'difficulty'),
    },
    {
        id: 'anchor_point',
        header: sortableHeader(t('climbing.anchor_point'), 'anchor_point'),
    },
    ...(showComments.value
        ? [
              {
                  id: 'comment',
                  header: sortableHeader(t('climbing.comment'), 'comment'),
              },
          ]
        : []),
    {
        id: 'creator',
        header: sortableHeader(t('climbing.creators'), 'creator'),
    },
    { id: 'score', header: sortableHeader(t('ratings.score'), 'score') },
    {
        id: 'screw_date',
        header: sortableHeader(t('routes.screwed_at'), 'screw_date'),
    },
    { id: 'actions', header: t('table.actions') },
])

function fetchRoutes(
    page: number,
    perPage: number,
): Promise<ListPage<RouteRecord>> {
    return listRoutes(gymId.value, {
        ...baseQuery.value,
        sort: routeSort(),
        include: ['location', 'wall'],
        page,
        limit: perPage,
        total: true,
    }).then((list) => ({ items: list.items, totalItems: list.total ?? 0 }))
}

const nuxtApp = useNuxtApp()
const loadedRoutePage = () =>
    nuxtApp._asyncData[cacheKeys.routesList]?.data
        .value as ListPage<RouteRecord>

function fetchLoadedRoutes(): Promise<ListPage<RouteRecord>> {
    const { page, itemsPerPage } = tableOptions
    return unlessQueryChanged(
        () => JSON.stringify([routeQueryKey.value, tableOptions.sortBy]),
        () =>
            isWideLayout.value
                ? fetchRoutes(page, itemsPerPage)
                : fetchRoutes(1, page * itemsPerPage),
        loadedRoutePage,
    )
}

useLiveQuery(cacheKeys.routesList, baseQuery)

const {
    data: routePage,
    error: routesError,
    refresh: refreshRoutes,
} = await useOfflineData(cacheKeys.routesList, fetchLoadedRoutes, {
    default: () => ({ items: [] as RouteRecord[], totalItems: 0 }),
})
loading.value = false

const loadFailed = ref(false)
watch(
    routesError,
    (error) => {
        loadFailed.value = !!error
    },
    { immediate: true },
)

async function retryLoad() {
    loadFailed.value = false
    tableOptions.page = 1
    await refreshRoutes()
}

const totalItems = computed(() => routePage.value.totalItems)
const routes = computed<RouteListItem[]>(() =>
    routePage.value.items.map(toRouteRow),
)

// Pages load one at a time, so the column stays once a page of this search showed a comment.
const commentsSeen = ref(false)
watch(
    routes,
    (list) => {
        const any = list.some((route) => route.comment)
        commentsSeen.value =
            tableOptions.page === 1 ? any : commentsSeen.value || any
    },
    { immediate: true },
)
const showComments = computed(
    () => commentsSeen.value || tableOptions.sortBy[0]?.key === 'comment',
)

const startRouteLoad = latestRequestTracker()

async function loadRoutes(
    options: RouteTableLoad = {},
    meta: { append?: boolean } = {},
): Promise<void> {
    const isLatest = startRouteLoad()
    loading.value = true
    const previousPage = tableOptions.page

    if (typeof options.page === 'number') tableOptions.page = options.page
    if (typeof options.itemsPerPage === 'number')
        tableOptions.itemsPerPage = options.itemsPerPage
    if (options.sortBy) tableOptions.sortBy = options.sortBy

    const loadedQuery = () =>
        JSON.stringify([routeQueryKey.value, tableOptions])
    const before = loadedQuery()
    try {
        const res = await unlessQueryChanged(
            loadedQuery,
            () => fetchRoutes(tableOptions.page, tableOptions.itemsPerPage),
            () => routePage.value,
        )
        if (!isLatest() || loadedQuery() !== before) return
        routePage.value = {
            items: meta.append
                ? routePage.value.items.concat(res.items)
                : res.items,
            totalItems: res.totalItems,
        }
        loadFailed.value = false
        if (!meta.append)
            announce(t('climbing.routesFound', { n: res.totalItems }))
    } catch (error) {
        if (!isLatest()) return
        if (meta.append) tableOptions.page = previousPage
        if (isAbortError(error)) return
        if (meta.append) notifyError(t('notifications.error.generic'))
        else loadFailed.value = true
    } finally {
        if (isLatest()) loading.value = false
    }
}

function loadMore() {
    if (loading.value || routes.value.length >= totalItems.value) return
    void loadRoutes({ page: tableOptions.page + 1 }, { append: true })
}

// Page 1 holds the same rows in both layouts, so only deeper paging needs a reload.
watch(isWideLayout, () => {
    if (tableOptions.page > 1) void loadRoutes({ page: 1 })
})

useIntersectionObserver(
    sentinelRef,
    ([entry]) => {
        if (entry?.isIntersecting) loadMore()
    },
    { rootMargin: '200px' },
)
</script>

<style scoped>
.route-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.route-wall {
    display: block;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    color: var(--ui-text-muted);
}
.route-comment {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
