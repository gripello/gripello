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
                    v-if="isMobile"
                    icon="i-lucide-plus"
                    color="primary"
                    :aria-label="$t('climbing.create')"
                    data-testid="routes-create-open"
                    @click="routeFormRef?.open()"
                />
                <UPopover v-if="isMobile" :content="{ align: 'end' }">
                    <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        :aria-label="$t('routes.moreActions')"
                        data-testid="routes-more"
                    />
                    <template #content="{ close }">
                        <nav class="flex min-w-[200px] flex-col gap-0.5 p-1">
                            <UButton
                                color="neutral"
                                variant="ghost"
                                icon="i-lucide-file-input"
                                data-testid="routes-import-open"
                                @click="openImport(close)"
                            >
                                {{ $t('actions.import') }}
                            </UButton>
                            <UButton
                                color="neutral"
                                variant="ghost"
                                icon="i-lucide-map-pinned"
                                :to="gymPath('/manage/map')"
                                data-testid="routes-place-on-map"
                                @click="close()"
                            >
                                {{ $t('routes.mapPlacement') }}
                            </UButton>
                        </nav>
                    </template>
                </UPopover>
            </template>
        </LayoutPageHeader>

        <MapUnplacedBanner />

        <RouteFormDialog
            ref="routeFormRef"
            @saved="onRouteSaved"
            @deleted="onRouteDeleted"
        />
        <ImportRoute ref="importRouteRef" @closed="reloadRoutes" />

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
                    <FilterSelect
                        :label="gradeColumnTitle"
                        v-model="selectedDifficulty"
                        :items="difficulties"
                        label-key="text"
                        value-key="value"
                        data-testid="routes-filter-difficulty"
                    />
                    <FilterSelect
                        :label="$t('climbing.type')"
                        v-model="selectedType"
                        :items="types"
                        label-key="text"
                        value-key="value"
                        data-testid="routes-filter-type"
                    />
                    <FilterSelect
                        :label="$t('climbing.location')"
                        v-model="selectedLocation"
                        :items="locations"
                        label-key="text"
                        value-key="value"
                        data-testid="routes-filter-location"
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

        <div v-if="!isMobile" class="mt-4" data-testid="routes-table">
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
                    <div class="route-manager__comment">
                        {{ row.original.comment }}
                    </div>
                </template>
                <template #creator-cell="{ row }">
                    <RouteCreators :creators="row.original.creator ?? []" />
                </template>
                <template #location-cell="{ row }">
                    {{ locationName(row.original) }}
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
                class="flex flex-wrap items-center justify-end gap-4 border-t px-2 py-3 text-sm"
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
            <USkeleton
                v-if="loading && routes.length === 0"
                class="mt-4 h-40 w-full"
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
                    <div class="route-manager__pager">
                        <UButton
                            icon="i-lucide-chevron-left"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :disabled="tableOptions.page <= 1"
                            :aria-label="$t('table.previous_page')"
                            data-testid="routes-mobile-prev"
                            @click="onMobilePageChange(tableOptions.page - 1)"
                        />
                        <template
                            v-for="(page, index) in pageItems"
                            :key="`${page}-${index}`"
                        >
                            <span
                                v-if="page === ELLIPSIS"
                                class="route-manager__page-gap"
                                data-testid="routes-mobile-page-gap"
                                aria-hidden="true"
                                >{{ page }}</span
                            >
                            <UButton
                                v-else
                                :variant="
                                    page === tableOptions.page
                                        ? 'solid'
                                        : 'ghost'
                                "
                                :color="
                                    page === tableOptions.page
                                        ? 'primary'
                                        : 'neutral'
                                "
                                :aria-current="
                                    page === tableOptions.page
                                        ? 'page'
                                        : undefined
                                "
                                :aria-label="
                                    $t('table.page_of', {
                                        page,
                                        total: pageLength,
                                    })
                                "
                                size="sm"
                                class="route-manager__page-btn justify-center"
                                :data-testid="`routes-mobile-goto-${page}`"
                                @click="onMobilePageChange(page)"
                            >
                                {{ page }}
                            </UButton>
                        </template>
                        <UButton
                            icon="i-lucide-chevron-right"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :disabled="tableOptions.page >= pageLength"
                            :aria-label="$t('table.next_page')"
                            data-testid="routes-mobile-next"
                            @click="onMobilePageChange(tableOptions.page + 1)"
                        />
                    </div>
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
import { isAbortError } from '~/utils/errors'
import { sendInBatches } from '~/utils/batch'
import type { ExportOptions } from '~/components/ExportOptionsDialog.vue'
import {
    formatAnchorPoint,
    formatScore,
    locationName,
    normalizeCreators,
} from '#shared/utils/formatting'
import { toPbSort, type SortOption } from '~/utils/sorting'
import { coalesce } from '~/utils/realtimeCache'
import type { TableColumn } from '@nuxt/ui'
import type { RouteListItem, RouteScoreRecord } from '~/types/models'

const gymPath = useGymPath()

interface LoadOptions {
    page?: number
    itemsPerPage?: number
    sortBy?: SortOption[]
}

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_routes',
})

const pb = usePocketbase()
const gymId = useCurrentGymId()
const { t, locale } = useI18n()
const { mdAndDown, width: displayWidth } = useDisplay()
const { notify, error: notifyError } = useNotification()
const { run: runAction } = useAsyncAction()
const { defectsByRoute } = useOpenDefects()

const isMobile = computed(() => mdAndDown.value)

const {
    searchRouteName,
    selectedDifficulty,
    selectedType,
    selectedLocation,
    difficulties,
    types,
    locations,
    activeFilterCount: routeFilterCount,
    pbFilter: baseFilter,
    clearFilters: clearRouteFilters,
} = useRouteFilters()

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

const tableOptions = reactive<{
    page: number
    itemsPerPage: number
    sortBy: SortOption[]
}>({
    page: 1,
    itemsPerPage: 25,
    sortBy: [{ key: 'screw_date', order: 'desc' }],
})

const pageSizeOptions = [10, 25, 50, 100]

const routeFormRef = useTemplateRef('routeFormRef')
const importRouteRef = useTemplateRef('importRouteRef')
const openImport = (close: () => void) => {
    close()
    importRouteRef.value?.open()
}

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
    th: 'px-2 xl:px-4',
    td: 'px-2 py-2 xl:px-4 whitespace-normal text-default',
}

const tableColumns = computed<TableColumn<RouteListItem>[]>(() => [
    { id: 'selected', meta: { class: { th: 'w-11', td: 'w-11' } } },
    { id: 'color', header: t('climbing.color') },
    { id: 'name', header: sortableHeader(t('climbing.routename'), 'name') },
    {
        id: 'difficulty',
        header: sortableHeader(gradeColumnTitle.value, 'difficulty'),
        meta: { class: { td: 'whitespace-nowrap' } },
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

const pageInfo = computed(() => {
    const { page, itemsPerPage } = tableOptions
    const start = totalItems.value ? (page - 1) * itemsPerPage + 1 : 0
    const end = Math.min(page * itemsPerPage, totalItems.value)
    return `${start}-${end} / ${totalItems.value}`
})

const pbFilter = computed(() => {
    const parts = [gymFilter(pb, gymId.value)]
    if (!displayArchived.value) parts.push('archived = false')
    const base = baseFilter.value
    if (base) parts.push(base)
    return parts.join(' && ')
})

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
} = useRouteSelection(pbFilter, totalItems)

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

const pageLength = computed(() =>
    Math.max(1, Math.ceil(totalItems.value / tableOptions.itemsPerPage)),
)

const PAGE_BUTTON = 36
const pageWindowSize = computed(() => {
    const spare = displayWidth.value - 32 - 96 - 16 - 2 * PAGE_BUTTON
    return Math.max(1, Math.min(7, Math.floor(spare / PAGE_BUTTON)))
})

const ELLIPSIS = '...' as const

const pageItems = computed(() => {
    const total = pageLength.value
    const current = tableOptions.page

    if (total <= pageWindowSize.value) {
        return Array.from({ length: total }, (_, index) => index + 1)
    }

    const budget = Math.max(3, pageWindowSize.value - 1)
    const inner = Math.max(1, budget - 2)
    const start = Math.max(
        2,
        Math.min(current - Math.floor((inner - 1) / 2), total - inner),
    )
    const end = Math.min(total - 1, start + inner - 1)

    const items: (number | typeof ELLIPSIS)[] = [1]
    if (start > 2) items.push(ELLIPSIS)
    for (let page = start; page <= end; page++) items.push(page)
    if (end < total - 1) items.push(ELLIPSIS)
    items.push(total)
    return items
})

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

const toPbSortRoutes = (sortByArr: SortOption[]) =>
    toPbSort(sortByArr, '-created', {
        score: 'average_rating',
        location: 'location.name',
        difficulty: 'type,grade_index',
    })

const sortItemsMobile = computed(() => [
    {
        title: t('routes.screwed_at'),
        key: 'screw_date',
        defaultOrder: 'desc' as const,
    },
    { title: t('ratings.score'), key: 'score', defaultOrder: 'desc' as const },
    { title: t('climbing.routename'), key: 'name' },
    { title: t('climbing.difficulty'), key: 'difficulty' },
    { title: t('climbing.anchor_point'), key: 'anchor_point' },
    { title: t('climbing.location'), key: 'location' },
    { title: t('climbing.type'), key: 'type' },
])

const onMobileSortChange = (sortBy: SortOption[]) => {
    void loadRoutes({ page: 1, sortBy })
}

const loadRoutes = async (options: LoadOptions = {}) => {
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
        const list = await pb
            .collection('averageRating')
            .getList<RouteScoreRecord>(
                tableOptions.page,
                tableOptions.itemsPerPage,
                {
                    filter: pbFilter.value || undefined,
                    sort: toPbSortRoutes(tableOptions.sortBy),
                    expand: 'location',
                    requestKey: 'adminRoutesList',
                },
            )

        const normalizedRoutes = list.items.map((route) => {
            const hasRatings =
                Number(route.ratings_count ?? 0) > 0 &&
                typeof route.average_rating === 'number'

            return {
                ...route,
                comment: typeof route.comment === 'string' ? route.comment : '',
                creator: normalizeCreators(route.creator),
                score: hasRatings ? route.average_rating : null,
                has_ratings: hasRatings,
            }
        })

        routes.value = normalizedRoutes
        totalItems.value = list.totalItems
    } catch (error) {
        if (isAbortError(error)) return
        console.error('Failed to load routes:', error)
        notifyError(t('notifications.error.generic'))
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

const reloadRoutes = async () => {
    invalidateAllRouteIdsCache()
    await loadRoutes({
        page: tableOptions.page,
        itemsPerPage: tableOptions.itemsPerPage,
        sortBy: tableOptions.sortBy,
    })

    const maxPage = Math.max(
        1,
        Math.ceil(totalItems.value / tableOptions.itemsPerPage),
    )
    if (tableOptions.page > maxPage) {
        tableOptions.page = maxPage
        await loadRoutes({
            page: tableOptions.page,
            itemsPerPage: tableOptions.itemsPerPage,
            sortBy: tableOptions.sortBy,
        })
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
            const archivedIds: string[] = []
            try {
                await sendInBatches(
                    pb,
                    ids,
                    (batch, id) =>
                        batch
                            .collection('routes')
                            .update(id, { archived: true }),
                    (chunk) => archivedIds.push(...chunk),
                )
                showArchiveConfirmation.value = false
            } finally {
                if (archivedIds.length) {
                    invalidateAllRouteIdsCache()
                    removeSelectedIds(archivedIds)
                    await reloadRoutes()
                }
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

let filterDebounceTimer: ReturnType<typeof setTimeout> | undefined

watch(pbFilter, () => {
    if (filterDebounceTimer) {
        clearTimeout(filterDebounceTimer)
    }

    filterDebounceTimer = setTimeout(() => {
        invalidateAllRouteIdsCache()
        tableOptions.page = 1
        void loadRoutes({
            page: 1,
            itemsPerPage: tableOptions.itemsPerPage,
            sortBy: tableOptions.sortBy,
        })
    }, 300)
})

const queueReload = coalesce(async () => {
    invalidateAllRouteIdsCache()
    await reloadRoutes()
}, 500)

const { subscribe } = usePbSubscription()

const { data: initial } = await useAsyncData('admin-routes', async () => {
    await loadRoutes({
        page: tableOptions.page,
        itemsPerPage: tableOptions.itemsPerPage,
        sortBy: tableOptions.sortBy,
    })
    return { routes: routes.value, totalItems: totalItems.value }
})

if (initial.value) {
    routes.value = initial.value.routes
    totalItems.value = initial.value.totalItems
}

onMounted(async () => {
    await Promise.all([
        subscribe('routes', (event) => {
            if (event.action === 'delete') removeSelectedIds([event.record.id])
            queueReload()
        }),
        subscribe('ratings', queueReload),
    ])
})

onBeforeUnmount(() => {
    clearTimeout(filterDebounceTimer)
})

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
    max-width: 260px;
    white-space: normal;
    overflow-wrap: break-word;
}

.route-manager__name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}

.route-manager__name-text {
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

.route-manager__pager {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 2px;
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
    color: color-mix(in oklab, var(--ui-text-highlighted) 50%, transparent);
}
</style>
