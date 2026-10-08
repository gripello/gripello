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
                    <FilterSelect
                        :label="gradeColumnTitle"
                        v-model="selectedDifficulty"
                        :items="difficulties"
                        label-key="text"
                        value-key="value"
                        data-testid="index-filter-difficulty"
                    />
                    <FilterSelect
                        :label="$t('climbing.type')"
                        v-model="selectedType"
                        :items="types"
                        label-key="text"
                        value-key="value"
                        data-testid="index-filter-type"
                    />
                    <FilterSelect
                        :label="$t('climbing.location')"
                        v-model="selectedLocation"
                        :items="locations"
                        label-key="text"
                        value-key="value"
                        data-testid="index-filter-location"
                    />
                    <FilterSelect
                        v-if="walls.length > 1"
                        :label="$t('map.wall')"
                        v-model="selectedWall"
                        :items="walls"
                        label-key="text"
                        value-key="value"
                        data-testid="index-filter-wall"
                    />
                </div>
            </template>
        </FilterBar>

        <div v-if="isWideLayout" class="mt-4" data-testid="index-table">
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
                        class="flex items-center"
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
                            class="ml-2"
                        />
                        <RouteRatedMarker
                            v-if="row.original.has_ratings"
                            class="ml-2"
                        />
                    </div>
                </template>
                <template #difficulty-cell="{ row }">
                    <GradeLabel :source="row.original" />
                </template>
                <template #anchor_point-cell="{ row }">
                    <span>{{
                        formatAnchorPoint(row.original.anchor_point)
                    }}</span>
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
                        <RouteDetails :route_id="row.original.id" />
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

        <div v-if="!isWideLayout">
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
            v-if="loading && routes.length === 0 && !isWideLayout"
            type="card"
            :count="1"
            class="mt-4"
        />
        <LayoutEmptyState
            v-if="!loading && routes.length === 0 && !isWideLayout"
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
            :grade="selectedDifficulty.split(':')[1]"
        />
    </div>
</template>

<script setup lang="ts">
import { isAbortError } from '~/utils/errors'
import type PocketBase from 'pocketbase'
import type { TableColumn } from '@nuxt/ui'
import type { RouteListItem, RouteScoreRecord } from '~/types/models'
import {
    formatAnchorPoint,
    formatScore,
    normalizeCreators,
    formatDate,
    wallName,
} from '#shared/utils/formatting'
import { toPbSort, type SortOption } from '~/utils/sorting'
import { cacheKeys } from '~/utils/realtimeCache'

const { t, locale } = useI18n()
const pb = usePocketbase() as PocketBase
const gymId = useCurrentGymId()
const { lgAndUp } = useDisplay()

const isWideLayout = computed(() => lgAndUp.value)
const wishDialog = ref(false)
const { error: notifyError } = useNotification()
const { polite: announce } = useAnnouncer()

const {
    searchRouteName,
    selectedDifficulty,
    selectedType,
    selectedLocation,
    selectedWall,
    difficulties,
    types,
    locations,
    walls,
    activeFilterCount,
    pbFilter: baseFilter,
    clearFilters,
} = useRouteFilters()

useSeoMeta({
    title: () => t('page.title.index'),
    description: () => t('page.content.index'),
    ogTitle: () => t('page.title.index'),
    ogDescription: () => t('page.content.index'),
    ogType: 'website',
})

interface TableOptions {
    page: number
    itemsPerPage: number
    sortBy: SortOption[]
}

const tableOptions = reactive<TableOptions>({
    page: 1,
    itemsPerPage: 20,
    sortBy: [{ key: 'screw_date', order: 'desc' }],
})

definePageMeta({ keepalive: true })

const loading = ref(true)
const { tickedRouteIds } = useTickedRoutes()
const { defectsByRoute } = useOpenDefects()
const sentinelRef = useTemplateRef<HTMLElement>('sentinelRef')

const { gradeColumnTitle } = useGradeSystems()

const UButton = resolveComponent('UButton')

function sortableHeader(label: string, key: string) {
    return () => {
        const active = tableOptions.sortBy[0]
        const order = active?.key === key ? active.order : undefined
        return h(UButton, {
            color: 'neutral',
            variant: 'ghost',
            label,
            trailingIcon:
                order === 'asc'
                    ? 'i-lucide-arrow-up'
                    : order === 'desc'
                      ? 'i-lucide-arrow-down'
                      : 'i-lucide-arrow-up-down',
            class: '-mx-2.5 w-[calc(100%+1.25rem)] font-semibold',
            onClick: () => toggleSort(key),
        })
    }
}

function toggleSort(key: string) {
    const active = tableOptions.sortBy[0]
    const sortBy: SortOption[] =
        active?.key !== key
            ? [{ key, order: 'asc' }]
            : active.order === 'asc'
              ? [{ key, order: 'desc' }]
              : []
    void loadRoutes({ page: 1, sortBy })
}

const tableUi = {
    th: 'px-2 last:pe-4 2xl:px-4',
    td: 'px-2 py-2 last:pe-4 2xl:px-4 whitespace-normal text-default',
}

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
    { id: 'comment', header: sortableHeader(t('climbing.comment'), 'comment') },
    {
        id: 'creator',
        header: sortableHeader(t('climbing.creators'), 'creator'),
        meta: { class: { td: 'min-w-24 whitespace-normal' } },
    },
    { id: 'score', header: sortableHeader(t('ratings.score'), 'score') },
    {
        id: 'screw_date',
        header: sortableHeader(t('routes.screwed_at'), 'screw_date'),
    },
    { id: 'actions', header: t('table.actions') },
])

const pageInfo = computed(() => {
    const { page, itemsPerPage } = tableOptions
    const start = totalItems.value ? (page - 1) * itemsPerPage + 1 : 0
    const end = Math.min(page * itemsPerPage, totalItems.value)
    return `${start}-${end} / ${totalItems.value}`
})

const pbFilter = computed(() => {
    const base = baseFilter.value
    return gymFilter(
        pb,
        gymId.value,
        base ? `archived = false && ${base}` : 'archived = false',
    )
})

const sortItemsMobile = computed(() => [
    {
        title: t('routes.screwed_at'),
        key: 'screw_date',
        defaultOrder: 'desc' as const,
    },
    {
        title: t('ratings.score'),
        key: 'score',
        defaultOrder: 'desc' as const,
    },
    { title: t('climbing.routename'), key: 'name' },
    { title: t('climbing.difficulty'), key: 'difficulty' },
    { title: t('climbing.anchor_point'), key: 'anchor_point' },
])

function onMobileSortChange(sortBy: SortOption[]) {
    tableOptions.sortBy = sortBy
    tableOptions.page = 1
    void loadRoutes({}, { append: false })
}

const toPbSortIndex = (sortByArr: SortOption[]) =>
    toPbSort(sortByArr, '-screw_date', {
        score: 'average_rating',
        difficulty: 'type,grade_index',
    })

function fetchRoutes(
    page: number,
    perPage: number,
    requestKey: string | null = 'routesList',
) {
    return pb
        .collection('averageRating')
        .getList<RouteScoreRecord>(page, perPage, {
            filter: pbFilter.value,
            sort: toPbSortIndex(tableOptions.sortBy),
            expand: 'location,wall',
            requestKey,
        })
}

function fetchLoadedRoutes() {
    const { page, itemsPerPage } = tableOptions
    return isWideLayout.value
        ? fetchRoutes(page, itemsPerPage, null)
        : fetchRoutes(1, page * itemsPerPage, null)
}

const { data: routePage } = await useAsyncData(
    cacheKeys.routesList,
    fetchLoadedRoutes,
    { default: () => ({ items: [] as RouteScoreRecord[], totalItems: 0 }) },
)
loading.value = false

const totalItems = computed(() => routePage.value.totalItems)
const routes = computed<RouteListItem[]>(() =>
    routePage.value.items.map((route) => {
        const hasRatings =
            Number(route.ratings_count ?? 0) > 0 &&
            typeof route.average_rating === 'number'
        return {
            ...route,
            creator: normalizeCreators(route.creator),
            has_ratings: hasRatings,
            score: hasRatings ? route.average_rating : undefined,
        }
    }),
)

async function loadRoutes(
    options: Partial<TableOptions> = {},
    meta: { append?: boolean } = {},
): Promise<void> {
    loading.value = true

    if (typeof options.page === 'number') tableOptions.page = options.page
    if (typeof options.itemsPerPage === 'number')
        tableOptions.itemsPerPage = options.itemsPerPage
    if (options.sortBy) tableOptions.sortBy = options.sortBy

    try {
        const res = await fetchRoutes(
            tableOptions.page,
            tableOptions.itemsPerPage,
        )
        routePage.value = {
            items: meta.append
                ? routePage.value.items.concat(res.items)
                : res.items,
            totalItems: res.totalItems,
        }
        if (!meta.append)
            announce(t('climbing.routesFound', { n: res.totalItems }))
    } catch (error) {
        if (isAbortError(error)) return
        console.error('Failed to load routes:', error)
        notifyError(t('notifications.error.generic'))
    } finally {
        loading.value = false
    }
}

function loadMore() {
    if (loading.value || routes.value.length >= totalItems.value) return
    tableOptions.page += 1
    void loadRoutes({}, { append: true })
}

let scrollObserver: IntersectionObserver | null = null

watch(sentinelRef, (sentinel) => {
    scrollObserver?.disconnect()
    scrollObserver = null
    if (!sentinel) return
    scrollObserver = new IntersectionObserver(
        (entries) => {
            if (entries[0]?.isIntersecting) loadMore()
        },
        { rootMargin: '200px' },
    )
    scrollObserver.observe(sentinel)
})

let debounceT: ReturnType<typeof setTimeout> | null = null
watch(pbFilter, () => {
    if (debounceT) {
        clearTimeout(debounceT)
    }

    debounceT = setTimeout(() => {
        tableOptions.page = 1
        void loadRoutes({}, { append: false })
    }, 300)
})

onBeforeUnmount(() => {
    if (debounceT) {
        clearTimeout(debounceT)
        debounceT = null
    }
    scrollObserver?.disconnect()
})
</script>

<style scoped>
.route-name {
    max-width: 224px;
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
