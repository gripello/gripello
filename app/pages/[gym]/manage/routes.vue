<template>
    <div class="route-manager mx-auto w-full p-4">
        <LayoutPageHeader :title="$t('routes.dashboard')" inline-actions>
            <template #actions>
                <template v-if="!isMobile">
                    <UButton
                        color="primary"
                        icon="i-lucide-route"
                        data-testid="routes-create-open"
                        @click="routeFormRef?.open()"
                    >
                        {{ $t('climbing.create') }}
                    </UButton>
                    <UButton
                        color="primary"
                        variant="soft"
                        icon="i-lucide-file-input"
                        data-testid="routes-import-open"
                        @click="importRouteRef?.open()"
                    >
                        {{ $t('actions.import') }}
                    </UButton>
                    <UButton
                        color="primary"
                        variant="soft"
                        icon="i-lucide-map-pinned"
                        :to="gymPath('/manage/map')"
                        data-testid="routes-place-on-map"
                    >
                        {{ $t('routes.mapPlacement') }}
                    </UButton>
                </template>
                <UButton
                    class="icon-btn"
                    v-if="isMobile"
                    icon="i-lucide-plus"
                    color="primary"
                    :aria-label="$t('climbing.create')"
                    data-testid="routes-create-open"
                    @click="routeFormRef?.open()"
                />
                <UDropdownMenu
                    v-if="isMobile"
                    :items="moreItems"
                    :content="{ align: 'end' }"
                >
                    <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        class="icon-btn"
                        :aria-label="$t('routes.moreActions')"
                        data-testid="routes-more"
                    />
                </UDropdownMenu>
            </template>
        </LayoutPageHeader>

        <MapUnplacedBanner />

        <RouteFormDialog
            ref="routeFormRef"
            @saved="onRouteSaved"
            @deleted="onRouteDeleted"
        />
        <ImportRoute ref="importRouteRef" @closed="reloadRoutes()" />

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
                        v-if="isMobile"
                        :model-value="tableOptions.sortBy"
                        :items="sortItemsMobile"
                        @update:model-value="onMobileSortChange"
                    />
                    <RouteFilterSelects
                        :filters="filters"
                        test-id-prefix="routes"
                    />
                    <div class="flex items-center">
                        <UButton
                            :color="displayArchived ? 'warning' : 'neutral'"
                            :variant="displayArchived ? 'soft' : 'outline'"
                            icon="i-lucide-archive"
                            class="rounded-full"
                            :aria-pressed="displayArchived"
                            data-testid="routes-filter-archived"
                            @click="displayArchived = !displayArchived"
                        >
                            {{ $t('filter.archived') }}
                        </UButton>
                    </div>
                    <div
                        class="flex w-full flex-wrap gap-x-4 gap-y-1 text-xs text-muted sm:hidden"
                        data-testid="routes-marker-legend"
                    >
                        <span class="flex items-center gap-1.5">
                            <RouteRatedMarker size="sm" />
                            {{ $t('routes.rated') }}
                        </span>
                        <span class="flex items-center gap-1.5">
                            <TaskDefectMarker severity="minor" size="sm" />
                            {{ $t('tasks.defect.marker') }}
                        </span>
                        <span class="flex items-center gap-1.5">
                            <TaskDefectMarker severity="urgent" size="sm" />
                            {{ $t('tasks.defect.urgentMarker') }}
                        </span>
                    </div>
                </div>
            </template>
        </FilterBar>

        <div class="route-manager__actions">
            <UButton
                color="primary"
                variant="soft"
                :icon="selectAllIcon"
                :size="isMobile ? 'sm' : 'md'"
                :aria-label="selectAllLabel"
                :title="selectAllAction"
                class="route-manager__count font-semibold"
                data-testid="routes-select-all"
                @click="selectAll"
            >
                {{ selectAllText }}
            </UButton>
            <UButton
                v-if="hasSelection"
                color="success"
                variant="soft"
                icon="i-lucide-printer"
                :loading="exportingFormat === 'pdf'"
                :disabled="!!exportingFormat && exportingFormat !== 'pdf'"
                :size="isMobile ? 'sm' : 'md'"
                data-testid="routes-export-pdf"
                @click="openExportOptions('pdf')"
            >
                {{ $t('actions.print') }}
            </UButton>
            <UButton
                v-if="hasSelection"
                color="success"
                variant="soft"
                icon="i-lucide-file-spreadsheet"
                :loading="exportingFormat === 'xlsx'"
                :disabled="!!exportingFormat && exportingFormat !== 'xlsx'"
                :size="isMobile ? 'sm' : 'md'"
                data-testid="routes-export-xlsx"
                @click="openExportOptions('xlsx')"
            >
                XLSX
            </UButton>
            <UButton
                v-if="hasSelection"
                color="success"
                variant="soft"
                icon="i-lucide-file-json"
                :loading="exportingFormat === 'json'"
                :disabled="!!exportingFormat && exportingFormat !== 'json'"
                :size="isMobile ? 'sm' : 'md'"
                data-testid="routes-export-json"
                @click="exportSelectedJson"
            >
                JSON
            </UButton>
            <UButton
                v-if="hasSelection"
                color="warning"
                variant="soft"
                icon="i-lucide-archive"
                :size="isMobile ? 'sm' : 'md'"
                data-testid="routes-archive-selected"
                @click="handleArchiveClick"
            >
                {{ $t('actions.archive') }}
            </UButton>
        </div>

        <LayoutLoadError v-if="loadFailed" class="mt-4" @retry="retryLoad" />

        <div v-else-if="!isMobile" class="mt-4" data-testid="routes-table">
            <UTable
                :data="routes"
                :columns="tableColumns"
                :loading="loading"
                :empty="$t('table.no_data')"
                :row-selection="rowSelection"
                :get-row-id="(route: RouteListItem) => route.id"
                :ui="tableUi"
            >
                <template #selected-cell="{ row }">
                    <UCheckbox
                        :model-value="selectedRouteIds.has(row.original.id)"
                        :aria-label="
                            $t('actions.select_route', {
                                name: row.original.name,
                            })
                        "
                        data-testid="routes-row-checkbox"
                        @update:model-value="
                            updateRouteSelection(row.original, !!$event)
                        "
                    />
                </template>
                <template #color-cell="{ row }">
                    <span
                        class="block size-6 rounded-full"
                        :style="{ background: row.original.color ?? undefined }"
                    />
                </template>
                <template #name-cell="{ row }">
                    <div
                        class="route-manager__name"
                        :data-testid="`routes-row-${row.original.id}`"
                    >
                        <span
                            class="route-manager__name-text"
                            :title="row.original.name"
                            data-testid="routes-row-name"
                            >{{ row.original.name }}</span
                        >
                        <TaskDefectMarker
                            :severity="defectsByRoute.get(row.original.id)"
                        />
                        <RouteRatedMarker v-if="row.original.has_ratings" />
                        <UBadge
                            v-if="row.original.archived"
                            size="sm"
                            color="neutral"
                            variant="outline"
                        >
                            {{ $t('filter.archived') }}
                        </UBadge>
                    </div>
                </template>
                <template #difficulty-cell="{ row }">
                    <GradeLabel :source="row.original" />
                </template>
                <template #anchor_point-cell="{ row }">
                    {{ formatAnchorPoint(row.original.anchor_point) }}
                </template>
                <template #comment-cell="{ row }">
                    <div
                        class="route-manager__comment"
                        :title="row.original.comment ?? undefined"
                    >
                        {{ row.original.comment }}
                    </div>
                </template>
                <template #creator-cell="{ row }">
                    <RouteCreators :creators="row.original.creator ?? []" />
                </template>
                <template #location-cell="{ row }">
                    <div
                        class="line-clamp-2 max-w-36"
                        :title="locationName(row.original)"
                    >
                        {{ locationName(row.original) }}
                    </div>
                </template>
                <template #type-cell="{ row }">
                    {{ row.original.type }}
                </template>
                <template #score-cell="{ row }">
                    {{ formatScore(row.original, locale) }}
                </template>
                <template #actions-cell="{ row }">
                    <div class="route-manager__row-actions">
                        <UButton
                            class="icon-btn"
                            icon="i-lucide-pencil"
                            color="neutral"
                            variant="ghost"
                            :aria-label="$t('actions.edit')"
                            data-testid="routes-row-edit"
                            @click="routeFormRef?.open(row.original)"
                        />
                        <RouteViewButton :route-id="row.original.id" compact />
                        <RouteDetails :route_id="row.original.id" />
                    </div>
                </template>
            </UTable>
            <div
                class="flex flex-wrap items-center justify-end gap-4 px-2 py-3 text-sm"
            >
                <div class="flex items-center gap-2">
                    <span class="text-muted">{{
                        $t('table.rows_per_page')
                    }}</span>
                    <USelect
                        :model-value="tableOptions.itemsPerPage"
                        :items="pageSizeOptions"
                        :aria-label="$t('table.rows_per_page')"
                        class="w-24"
                        data-testid="routes-page-size"
                        @update:model-value="
                            loadRoutes({
                                page: 1,
                                itemsPerPage: Number($event),
                            })
                        "
                    />
                </div>
                <span data-testid="table-page-info">{{ pageInfo }}</span>
                <UPagination
                    :page="tableOptions.page"
                    :total="totalItems"
                    :items-per-page="tableOptions.itemsPerPage"
                    @update:page="loadRoutes({ page: $event })"
                />
            </div>
        </div>

        <div v-else class="route-manager__mobile-section">
            <LayoutLoadingState
                v-if="loading && routes.length === 0"
                class="mt-4"
            />
            <LayoutEmptyState
                v-else-if="!loading && routes.length === 0"
                class="mt-4"
                :title="$t('table.no_data')"
            />
            <div
                v-else
                ref="mobileListRef"
                class="route-manager__rows native-group"
                data-testid="routes-rows"
            >
                <RouteManageRow
                    v-for="route in routes"
                    :key="route.id"
                    :route="route"
                    :selected="selectedRouteIds.has(route.id)"
                    :defect="defectsByRoute.get(route.id)"
                    @update:selected="updateRouteSelection(route, $event)"
                    @edit="routeFormRef?.open(route)"
                >
                    <template #actions>
                        <RouteDetails :route_id="route.id" compact />
                        <RouteViewButton :route-id="route.id" compact />
                    </template>
                </RouteManageRow>
            </div>

            <nav
                class="route-manager__mobile-pagination"
                :aria-label="$t('table.pagination')"
                data-testid="routes-mobile-pagination"
            >
                <div class="route-manager__pager-pill">
                    <UPagination
                        :page="tableOptions.page"
                        :total="totalItems"
                        :items-per-page="tableOptions.itemsPerPage"
                        :sibling-count="displayWidth < 480 ? 0 : 1"
                        show-edges
                        :show-controls="false"
                        :ui="{ list: 'gap-0.5' }"
                        @update:page="onMobilePageChange"
                    >
                        <template #prev>
                            <UButton
                                class="icon-btn"
                                icon="i-lucide-chevron-left"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="$t('table.previous_page')"
                                data-testid="routes-mobile-prev"
                            />
                        </template>
                        <template #item="{ item, page, pageCount }">
                            <UButton
                                v-if="item.type === 'page'"
                                :variant="
                                    page === item.value ? 'solid' : 'ghost'
                                "
                                :color="
                                    page === item.value ? 'primary' : 'neutral'
                                "
                                :aria-label="
                                    $t('table.page_of', {
                                        page: item.value,
                                        total: pageCount,
                                    })
                                "
                                size="sm"
                                class="route-manager__page-btn justify-center"
                                :data-testid="`routes-mobile-goto-${item.value}`"
                            >
                                {{ item.value }}
                            </UButton>
                        </template>
                        <template #ellipsis>
                            <span
                                class="route-manager__page-gap"
                                data-testid="routes-mobile-page-gap"
                                aria-hidden="true"
                                >...</span
                            >
                        </template>
                        <template #next>
                            <UButton
                                class="icon-btn"
                                icon="i-lucide-chevron-right"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                :aria-label="$t('table.next_page')"
                                data-testid="routes-mobile-next"
                            />
                        </template>
                    </UPagination>
                    <USelect
                        :model-value="tableOptions.itemsPerPage"
                        :items="pageSizeOptions"
                        :aria-label="$t('table.rows_per_page')"
                        variant="ghost"
                        size="sm"
                        class="route-manager__page-size w-20"
                        data-testid="routes-mobile-page-size"
                        @update:model-value="onItemsPerPageChange"
                    />
                </div>
            </nav>
        </div>

        <ExportOptionsDialog
            v-model="showExportOptions"
            :format="exportFormat"
            @confirm="exportSelected"
        />

        <ConfirmDialog
            v-model="showArchiveConfirmation"
            :message="$t('notifications.archiveMoreItems')"
            confirm-color="warning"
            :confirm-text="$t('actions.archive')"
            @confirm="archiveSelected"
        />
    </div>
</template>

<script setup lang="ts">
import { gymChangesTopic } from '#shared/utils/topics'
import { archiveRoutes, listRoutes, type RouteQuery } from '~/api/routes'
import { isAbortError } from '~/utils/errors'
import type { ExportOptions } from '~/components/export/OptionsDialog.vue'
import {
    formatAnchorPoint,
    formatScore,
    locationName,
} from '#shared/utils/formatting'
import { toRouteRow, type RouteTableLoad } from '~/composables/useRouteTable'
import {
    coalesce,
    coalesceIds,
    staffRouteChange,
    type GymChange,
} from '~/utils/realtimeCache'
import type { TableColumn } from '@nuxt/ui'
import type { RouteListItem } from '~/types/models'

const gymPath = useGymPath()

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_routes',
})

const gymId = useCurrentGymId()
const { t, locale } = useI18n()
const { mdAndDown, width: displayWidth } = useDisplay()
const { notify, error: notifyError } = useNotification()
const { run: runAction } = useAsyncAction()
const { defectsByRoute } = useOpenDefects()

const isMobile = computed(() => mdAndDown.value)

const filters = useRouteFilters('manage-routes')
const {
    searchRouteName,
    activeFilterCount: routeFilterCount,
    routeQuery: baseQuery,
    clearFilters: clearRouteFilters,
} = filters

const displayArchived = ref(false)

const activeFilterCount = computed(
    () => routeFilterCount.value + (displayArchived.value ? 1 : 0),
)

function clearFilters() {
    clearRouteFilters()
    displayArchived.value = false
}

const showArchiveConfirmation = ref(false)

const routes = ref<RouteListItem[]>([])
const totalItems = ref(0)
const loading = ref(false)
const listFailed = ref(false)

const pageSizeOptions = [10, 25, 50, 100]

const routeFormRef = useTemplateRef('routeFormRef')
const importRouteRef = useTemplateRef('importRouteRef')
const moreItems = computed(() => [
    {
        label: t('actions.import'),
        icon: 'i-lucide-file-input',
        'data-testid': 'routes-import-open',
        onSelect: () => importRouteRef.value?.open(),
    },
    {
        label: t('routes.mapPlacement'),
        icon: 'i-lucide-map-pinned',
        to: gymPath('/manage/map'),
        'data-testid': 'routes-place-on-map',
    },
])

const { gradeColumnTitle } = useGradeSystems()

const routeQuery = computed<RouteQuery>(() => ({
    ...baseQuery.value,
    archived: displayArchived.value ? 'all' : false,
}))
const routeQueryKey = computed(() => JSON.stringify(routeQuery.value))

const {
    tableOptions,
    tableUi,
    sortableHeader,
    pageInfo,
    sortItemsMobile: baseSortItems,
    onMobileSortChange,
    routeSort,
} = useRouteTable({
    itemsPerPage: 25,
    totalItems,
    queryKey: routeQueryKey,
    defaultSort: '-created',
    load: (options) => loadRoutes(options),
})
const sortItemsMobile = computed(() => [
    ...baseSortItems.value,
    { title: t('climbing.location'), key: 'location' },
    { title: t('climbing.type'), key: 'type' },
])

const tableColumns = computed<TableColumn<RouteListItem>[]>(() => [
    { id: 'selected', meta: { class: { th: 'w-11', td: 'w-11' } } },
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
    { id: 'comment', header: t('climbing.comment') },
    { id: 'creator', header: t('routes.route_setter') },
    {
        id: 'location',
        header: sortableHeader(t('climbing.location'), 'location'),
    },
    { id: 'type', header: sortableHeader(t('climbing.type'), 'type') },
    { id: 'score', header: sortableHeader(t('ratings.score'), 'score') },
    {
        id: 'actions',
        header: t('table.actions'),
        meta: { class: { th: 'text-end' } },
    },
])

const rowSelection = computed(() =>
    Object.fromEntries(Array.from(selectedRouteIds.value, (id) => [id, true])),
)

const {
    selectedRouteIds,
    selectedCount,
    hasSelection,
    areAllSelected,
    update: updateSelection,
    clear: clearSelection,
    remove: removeSelectedIds,
    toggleAll,
    invalidate: invalidateAllRouteIdsCache,
} = useRouteSelection(gymId, routeQuery, totalItems)

const selectAllAction = computed(() =>
    areAllSelected.value ? t('actions.deselect_all') : t('actions.select_all'),
)
const selectAllText = computed(() =>
    hasSelection.value
        ? t('routes.selectedCount', { n: selectedRouteIds.value.size })
        : t('actions.select_all'),
)
const selectAllLabel = computed(() =>
    hasSelection.value
        ? `${selectAllText.value}, ${selectAllAction.value}`
        : selectAllAction.value,
)
const selectAllIcon = computed(() => {
    if (areAllSelected.value) return 'i-lucide-square-check-big'
    if (hasSelection.value) return 'i-lucide-square-minus'
    return 'i-lucide-square'
})

const { exportingFormat, exportPdf, exportXlsx, exportJson } = useRouteExport()
const selectedIds = () => Array.from(selectedRouteIds.value)

const updateRouteSelection = (route: RouteListItem, isSelected: boolean) =>
    updateSelection(route.id, isSelected)

const selectAll = async () => {
    try {
        await toggleAll()
    } catch (error) {
        console.error('Failed to select all routes:', error)
        notifyError(t('routes.selectAllError'))
    }
}

const loadRoutes = async (
    options: RouteTableLoad = {},
    { background = false } = {},
) => {
    const { page, itemsPerPage, sortBy } = options

    if (typeof page === 'number') {
        tableOptions.page = page
    }

    if (typeof itemsPerPage === 'number') {
        tableOptions.itemsPerPage = itemsPerPage
    }

    if (Array.isArray(sortBy)) {
        tableOptions.sortBy = sortBy
    }

    loading.value = true

    try {
        const list = await listRoutes(gymId.value, {
            ...routeQuery.value,
            sort: routeSort(),
            include: ['location'],
            page: tableOptions.page,
            limit: tableOptions.itemsPerPage,
            total: true,
        })

        routes.value = list.items.map(toRouteRow)
        totalItems.value = list.total ?? 0
        listFailed.value = false
    } catch (error) {
        if (isAbortError(error)) return
        if (!background || routes.value.length === 0) listFailed.value = true
    } finally {
        loading.value = false
    }
}

const onRouteSaved = async (payload?: { id?: string } | null) => {
    notify(
        t(
            payload?.id
                ? 'notifications.success.edit'
                : 'notifications.success.create',
        ),
    )
    await reloadRoutes()
}

const onRouteDeleted = async (id: string) => {
    removeSelectedIds([id])
    notify(t('notifications.success.delete'))
    await reloadRoutes()
}

const reloadRoutes = async ({ background = false } = {}) => {
    invalidateAllRouteIdsCache()
    await loadRoutes(
        {
            page: tableOptions.page,
            itemsPerPage: tableOptions.itemsPerPage,
            sortBy: tableOptions.sortBy,
        },
        { background },
    )

    const maxPage = Math.max(
        1,
        Math.ceil(totalItems.value / tableOptions.itemsPerPage),
    )
    if (tableOptions.page > maxPage) {
        tableOptions.page = maxPage
        await loadRoutes(
            {
                page: tableOptions.page,
                itemsPerPage: tableOptions.itemsPerPage,
                sortBy: tableOptions.sortBy,
            },
            { background },
        )
    }
}

const handleArchiveClick = () => {
    if (selectedCount.value > 1) {
        showArchiveConfirmation.value = true
    } else {
        void archiveSelected()
    }
}

const archiveSelected = async () => {
    const ids = Array.from(selectedRouteIds.value)
    if (!ids.length) {
        return
    }

    await runAction(
        async () => {
            let archived = false
            try {
                await archiveRoutes(gymId.value, ids)
                archived = true
                showArchiveConfirmation.value = false
            } finally {
                invalidateAllRouteIdsCache()
                if (archived) removeSelectedIds(ids)
                await reloadRoutes()
            }
        },
        { success: t('notifications.success.edit') },
    )
}

const exportFormat = ref<'pdf' | 'xlsx'>('xlsx')
const showExportOptions = ref(false)
const openExportOptions = (format: 'pdf' | 'xlsx') => {
    exportFormat.value = format
    showExportOptions.value = true
}
const exportSelected = (options: ExportOptions) =>
    (exportFormat.value === 'pdf' ? exportPdf : exportXlsx)(
        selectedIds(),
        options,
    )
const exportSelectedJson = () => exportJson(selectedIds())

const mobileListRef = useTemplateRef('mobileListRef')

const onMobilePageChange = async (value: number) => {
    if (value === tableOptions.page) {
        return
    }

    await loadRoutes({ page: value })

    mobileListRef.value?.scrollIntoView({ block: 'start' })
}

const onItemsPerPageChange = (value: number | string) => {
    const size = Number(value)
    if (!size || size === tableOptions.itemsPerPage) {
        return
    }

    clearSelection()
    void loadRoutes({ page: 1, itemsPerPage: size })
}

const rescoreSoon = coalesceIds(async (ids) => {
    if (!ids) return queueReload()
    const { items } = await listRoutes(gymId.value, {
        ids: [...ids],
        archived: 'all',
    })
    for (const { id, average_rating, ratings_count } of items)
        routes.value = routes.value.map((route) =>
            route.id === id
                ? toRouteRow({ ...route, average_rating, ratings_count })
                : route,
        )
}, 500)

const queueReload = coalesce(() => reloadRoutes({ background: true }), 500)

const { data: initial, error: initialError } = await useAsyncData(
    'admin-routes',
    async () => {
        await loadRoutes({
            page: tableOptions.page,
            itemsPerPage: tableOptions.itemsPerPage,
            sortBy: tableOptions.sortBy,
        })
        if (listFailed.value) throw new Error('routes failed to load')
        return { routes: routes.value, totalItems: totalItems.value }
    },
)
const loadFailed = computed(() => listFailed.value || !!initialError.value)

async function retryLoad() {
    await loadRoutes()
    if (!listFailed.value) initialError.value = undefined
}

if (initial.value) {
    routes.value = initial.value.routes
    totalItems.value = initial.value.totalItems
}

useRealtime(
    () => gymChangesTopic(gymId.value),
    (change: GymChange) => {
        if (change.collection === 'routes' && change.action === 'delete')
            removeSelectedIds([change.record.id as string])
        const next = staffRouteChange(routes.value, change)
        if (next.rows !== routes.value) routes.value = next.rows.map(toRouteRow)
        if (next.reload) queueReload()
        if (next.rescore) rescoreSoon(next.rescore)
    },
    { resync: queueReload },
)

useHead(() => ({
    title: t('page.title.dashboard'),
    meta: [
        {
            name: 'description',
            content: t('page.content.dashboard'),
        },
    ],
}))
</script>

<style scoped>
@reference "~/assets/css/main.css";

.route-manager {
    padding-bottom: 64px;
}

@variant max-xl {
    .route-manager {
        padding-bottom: 0;
    }
}

.route-manager__rows {
    margin-top: 8px;
}

.route-manager__count {
    font-weight: 600;
}

.route-manager__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-bottom: 16px;
}

.route-manager__comment {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.route-manager__name {
    display: flex;
    align-items: center;
    gap: 6px;
}

.route-manager__name-text {
    max-width: 224px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
}

.route-manager__row-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
}

.route-manager__mobile-section {
    display: flex;
    flex-direction: column;
}

.route-manager__mobile-pagination {
    position: sticky;
    bottom: calc(
        var(--app-bottom, 0px) + env(safe-area-inset-bottom, 0px) + 16px
    );
    z-index: 2;
    display: flex;
    justify-content: center;
    margin-top: 16px;
    pointer-events: none;
}

.route-manager__pager-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border: 1px solid var(--ui-border);
    border-radius: 999px;
    background: var(--ui-bg);
    box-shadow: 0 6px 20px -6px rgb(0 0 0 / 0.35);
    pointer-events: auto;
}

.route-manager__page-size {
    max-width: 96px;
}

.route-manager__page-btn {
    min-width: 32px;
    padding-inline: 0;
    border-radius: 999px;
}

.route-manager__page-gap {
    min-width: 16px;
    text-align: center;
    font-size: 0.75rem;
    color: var(--ui-text-muted);
}
</style>
