<template>
    <div>
        <input
            ref="fileInput"
            type="file"
            class="hidden"
            accept=".json,.csv,.tsv,.txt,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            data-testid="import-route-file-input"
            @change="handleFileChange"
        />

        <LayoutDialogShell
            v-model="showPreviewDialog"
            max-width="900"
            persistent
            closable
            sheet-on-mobile
            :title="$t('importRoutes.title')"
            data-testid="import-route-dialog"
        >
            <p class="mb-4 text-sm text-muted">
                {{ $t('importRoutes.intro') }}
            </p>

            <SegmentedControl
                v-model="mode"
                :items="modeItems"
                test-id="import-mode"
                class="mb-4"
            />

            <LayoutPanel :title="$t('export.columns')" class="mb-4">
                <div
                    class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    data-testid="import-route-mapping"
                >
                    <UFormField
                        v-for="field in fields"
                        :key="field"
                        :label="fieldLabels[field]"
                    >
                        <USelect
                            :model-value="mapping[field] ?? NOT_MAPPED"
                            :items="columnItems"
                            class="w-full"
                            :data-testid="`import-route-map-${field}`"
                            @update:model-value="setMapping(field, $event)"
                        />
                    </UFormField>
                </div>
            </LayoutPanel>

            <LayoutLoadingState v-if="mode === 'reviews' && routesLoading" />
            <template v-else-if="mode === 'reviews'">
                <LayoutEyebrow class="mb-2" data-testid="import-review-count">
                    {{
                        $t('importRoutes.matchedCount', {
                            matched: matchedReviews.length,
                            total: reviewsToImport.length,
                        })
                    }}
                </LayoutEyebrow>
                <LayoutEmptyState
                    v-if="routesError"
                    variant="error"
                    :card="false"
                    :title="$t('importRoutes.failed')"
                />
                <LayoutListGroup v-else>
                    <LayoutListRow
                        v-for="(review, index) in reviewPreview"
                        :key="index"
                        data-testid="import-review-row"
                    >
                        <RouteSummary
                            v-if="review.route"
                            :route="review.route"
                            size="sm"
                            :meta="review.route.expand?.location?.name"
                            class="w-2/5 shrink-0"
                        />
                        <p
                            v-else
                            class="w-2/5 shrink-0 truncate text-sm text-error"
                        >
                            {{ $t('importRoutes.noMatch') }}:
                            {{ review.routeName || review.routeKey }}
                        </p>
                        <div class="min-w-0 flex-1 text-sm">
                            <p class="truncate">
                                {{
                                    review.comment ||
                                    $t('importRoutes.noComment')
                                }}
                            </p>
                            <p class="truncate text-xs text-muted">
                                {{
                                    [
                                        review.rating && `${review.rating}/5`,
                                        review.grade,
                                        formatDate(review.created, { locale }),
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')
                                }}
                            </p>
                        </div>
                    </LayoutListRow>
                </LayoutListGroup>
            </template>

            <LayoutListGroup
                v-else-if="smAndDown"
                data-testid="import-route-list"
            >
                <UCollapsible
                    v-for="(item, index) in routesToImport"
                    :key="index"
                    as="li"
                    data-testid="import-route-list-item"
                >
                    <button
                        type="button"
                        class="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                        <span
                            class="size-6 shrink-0 rounded-full"
                            :style="{ background: item.color ?? undefined }"
                        />
                        <div class="flex-1">
                            <div class="text-base">
                                {{ String(item.name ?? '') }}
                            </div>
                            <div class="text-xs text-muted">
                                {{ previewSummary(item) }}
                            </div>
                        </div>
                        <UIcon
                            name="i-lucide-chevron-down"
                            class="size-5 shrink-0"
                        />
                    </button>
                    <template #content>
                        <div class="px-4 pb-2">
                            <ImportRouteRatings
                                :name="item.name"
                                :ratings="item.ratings"
                            />
                        </div>
                    </template>
                </UCollapsible>
            </LayoutListGroup>

            <UTable
                v-else
                v-model:expanded="expanded"
                :data="routesToImport"
                :columns="previewColumns"
            >
                <template #color-cell="{ row }">
                    <span
                        class="block size-6 rounded-full"
                        :style="{ background: row.original.color ?? undefined }"
                    />
                </template>

                <template #expand-cell="{ row }">
                    <UButton
                        class="icon-btn"
                        color="neutral"
                        variant="ghost"
                        :icon="
                            row.getIsExpanded()
                                ? 'i-lucide-chevron-up'
                                : 'i-lucide-chevron-down'
                        "
                        :aria-label="$t('importRoutes.ratingsCount')"
                        @click="row.toggleExpanded()"
                    />
                </template>

                <template #expanded="{ row }">
                    <ImportRouteRatings
                        :name="row.original.name"
                        :ratings="row.original.ratings"
                    />
                </template>
            </UTable>

            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    data-testid="import-route-cancel"
                    @click="cancelImport"
                >
                    {{ $t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    color="primary"
                    :loading="loading"
                    :disabled="
                        mode === 'reviews' &&
                        (routesLoading || !matchedReviews.length)
                    "
                    data-testid="import-route-confirm"
                    @click="confirmImport"
                >
                    {{ $t('importRoutes.confirm') }}
                </UButton>
            </template>
        </LayoutDialogShell>
    </div>
</template>
<script setup lang="ts">
import { importRatings } from '~/api/ratings'
import { createRoute, listRoutes, listWalls } from '~/api/routes'
import { formatDate, normalizeCreators } from '#shared/utils/formatting'
import { resolveImportedGrading } from '#shared/utils/grades'
import type { TableColumn } from '@nuxt/ui'
import type { LocationRecord, RouteRecord, UserRecord } from '~/types/models'
import { ROUTE_TYPES } from '~/utils/routes'
import {
    REVIEW_IMPORT_FIELDS,
    ROUTE_IMPORT_FIELDS,
    guessImportMapping,
    matchReviewRoute,
    tableFromCsv,
    tableFromJson,
    tableFromXlsx,
    toImportedReview,
    toImportedRoute,
    type ImportField,
    type ImportTable,
    type ImportedRating,
    type ImportedRoute,
} from '~/utils/routeImport'

type ImportMode = 'routes' | 'reviews'
type ExistingRoute = RouteRecord & {
    expand?: { location?: Pick<LocationRecord, 'name'> }
}

const NOT_MAPPED = '__none__'
const REVIEW_PREVIEW_LIMIT = 100
const RATING_CHUNK = 200

const authStore = useAuthStore()
const gymId = useCurrentGymId()
const emit = defineEmits<{ closed: [] }>()
const currentUser = authStore.record as UserRecord | null

const fileInput = ref<HTMLInputElement | null>(null)
const showPreviewDialog = ref(false)
const loading = ref(false)
const table = ref<ImportTable>({ headers: [], rows: [] })
const mapping = ref<Partial<Record<ImportField, string>>>({})
const mode = ref<ImportMode>('routes')
const existingRoutes = ref<ExistingRoute[]>([])
const routesError = ref(false)
const routesLoading = ref(false)
let routesRequest = 0
const sourceIds = new Map<string, string>()
const expanded = ref<Record<string, boolean>>({})

const { t, locale } = useI18n()
const { notify, error: notifyError } = useNotification()
const { data: locationRecords } = useLocations()
const { gradeSystemFor } = useGradeSystems()

const { smAndDown } = useDisplay()

const fieldLabels = computed<Record<ImportField, string>>(() => ({
    source_id: t('importRoutes.sourceId'),
    route: t('importRoutes.routeId'),
    route_name: t('climbing.routename'),
    rating: t('importRoutes.ratingLabel'),
    created: t('importRoutes.reviewDate'),
    name: t('routes.name'),
    grade: t('climbing.difficulty'),
    grade_system: t('importRoutes.gradeSystem'),
    type: t('climbing.type'),
    location: t('climbing.location'),
    wall: t('map.wall'),
    anchor_point: t('climbing.anchor_point'),
    color: t('climbing.color'),
    creator: t('climbing.creators'),
    screw_date: t('routes.screwed_at'),
    comment: t('climbing.comment'),
    archived: t('climbing.archived'),
}))

const columnItems = computed(() => [
    { label: t('importRoutes.notMapped'), value: NOT_MAPPED },
    ...table.value.headers.map((header) => ({ label: header, value: header })),
])

const modeItems = computed(() => [
    { value: 'routes' as const, label: t('routes.list') },
    { value: 'reviews' as const, label: t('routes.comments') },
])

const fields = computed(() =>
    mode.value === 'routes' ? ROUTE_IMPORT_FIELDS : REVIEW_IMPORT_FIELDS,
)

const setMapping = (field: ImportField, header: string) => {
    mapping.value = {
        ...mapping.value,
        [field]: header === NOT_MAPPED ? undefined : header,
    }
}

const typeByLabel = computed(
    () =>
        new Map(
            ROUTE_TYPES.flatMap((type) => [
                [type.toLowerCase(), type],
                [t(`routes.types.${type.toLowerCase()}`).toLowerCase(), type],
            ]),
        ),
)

const routesToImport = computed(() =>
    table.value.rows.map((row) =>
        toImportedRoute(row, mapping.value, {
            typeByLabel: typeByLabel.value,
            gradeSystemFor,
            locale: locale.value,
        }),
    ),
)

const matchableRoutes = computed(() =>
    existingRoutes.value.map((route) => ({
        id: route.id,
        name: route.name,
        location: route.expand?.location?.name ?? '',
        date: route.screw_date || route.created || '',
    })),
)

const routeById = computed(
    () => new Map(existingRoutes.value.map((route) => [route.id, route])),
)

const reviewsToImport = computed(() =>
    mode.value === 'reviews'
        ? table.value.rows.map((row) => {
              const review = toImportedReview(row, mapping.value, locale.value)
              const routeId = matchReviewRoute(
                  review,
                  matchableRoutes.value,
                  sourceIds,
              )
              return {
                  ...review,
                  route: routeId ? routeById.value.get(routeId) : undefined,
              }
          })
        : [],
)

const matchedReviews = computed(() =>
    reviewsToImport.value.filter((review) => review.route),
)

// ponytail: preview capped, the import itself sends every row
const reviewPreview = computed(() =>
    [...reviewsToImport.value]
        .sort((left, right) => Number(!!left.route) - Number(!!right.route))
        .slice(0, REVIEW_PREVIEW_LIMIT),
)

const loadExistingRoutes = async () => {
    const request = ++routesRequest
    routesLoading.value = true
    routesError.value = false
    try {
        const { items: routes } = await listRoutes<ExistingRoute>(
            gymId.value,
            { archived: 'all', include: ['location'] },
            {
                fields: 'id,name,type,color,grade,grade_system,grade_index,screw_date,created,expand.location.name',
                requestKey: null,
            },
        )
        if (request === routesRequest) existingRoutes.value = routes
    } catch (error) {
        if (request !== routesRequest) return
        console.error('Failed to load routes for review import', error)
        routesError.value = true
    } finally {
        if (request === routesRequest) routesLoading.value = false
    }
}

watch(mode, (current) => {
    mapping.value = guessImportMapping(
        fields.value,
        table.value.headers,
        fieldLabels.value,
    )
    if (current === 'reviews' && showPreviewDialog.value) loadExistingRoutes()
})

const previewSummary = (route: ImportedRoute) =>
    [
        route.grade ?? route.difficulty,
        route.anchor_point,
        route.location,
        `${t('importRoutes.ratingsCount')}: ${route.ratings?.length || 0}`,
    ]
        .filter((part) => part !== undefined && part !== null && part !== '')
        .join(' · ')

const previewColumns = computed<TableColumn<ImportedRoute>[]>(() => [
    { id: 'color', header: t('climbing.color') },
    { accessorKey: 'name', header: t('routes.name') },
    {
        id: 'difficulty',
        header: t('climbing.difficulty'),
        accessorFn: (route) => route.grade ?? route.difficulty,
    },
    { accessorKey: 'anchor_point', header: t('climbing.anchor_point') },
    { accessorKey: 'location', header: t('climbing.location') },
    {
        id: 'ratings',
        header: t('importRoutes.ratingsCount'),
        accessorFn: (route) => route.ratings?.length || 0,
    },
    { id: 'expand' },
])

const open = () => {
    fileInput.value?.click()
}

defineExpose({ open })

const readTable = async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension === 'xlsx') return tableFromXlsx(await file.arrayBuffer())
    const text = await file.text()
    return extension === 'json' || file.type === 'application/json'
        ? tableFromJson(JSON.parse(text))
        : tableFromCsv(text)
}

const handleFileChange = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    try {
        table.value = await readTable(file)
        if (table.value.rows.length === 0) throw new Error('No rows.')
        mapping.value = guessImportMapping(
            fields.value,
            table.value.headers,
            fieldLabels.value,
        )
        if (mode.value === 'reviews') await loadExistingRoutes()
        showPreviewDialog.value = true
    } catch (error) {
        console.error('Error reading import file:', error)
        notifyError(t('importRoutes.invalidFile'))
    }
}

const cancelImport = () => {
    showPreviewDialog.value = false
    table.value = { headers: [], rows: [] }
    mapping.value = {}
    existingRoutes.value = []
}

const notifyResult = (parts: string[]) => {
    if (parts.length === 0) {
        notify(t('importRoutes.success'))
    } else {
        notify(
            t('importRoutes.issues', { details: parts.join(', ') }),
            'warning',
        )
    }
}

const postRatings = async (
    ratings: ReturnType<typeof sanitizeRatingPayload>[],
) => {
    let failed = 0
    for (let start = 0; start < ratings.length; start += RATING_CHUNK) {
        const chunk = ratings.slice(start, start + RATING_CHUNK)
        try {
            const response = await importRatings(gymId.value, chunk)
            failed += response.failed
        } catch (error) {
            console.error('Failed to insert ratings', error)
            failed += chunk.length
        }
    }
    return failed
}

const confirmReviewImport = async () => {
    const ratings = matchedReviews.value.map((review) =>
        sanitizeRatingPayload(review, {
            routeId: review.route!.id,
            routeType: review.route!.type,
        }),
    )
    const failed = await postRatings(ratings)
    const unmatched = reviewsToImport.value.length - ratings.length
    notifyResult([
        ...(failed
            ? [t('importRoutes.commentsFailed', { count: failed }, failed)]
            : []),
        ...(unmatched
            ? [
                  t(
                      'importRoutes.reviewsUnmatched',
                      { count: unmatched },
                      unmatched,
                  ),
              ]
            : []),
    ])
}

const confirmImport = async () => {
    loading.value = true
    const jsonData = routesToImport.value

    try {
        if (mode.value === 'reviews') {
            await confirmReviewImport()
            emit('closed')
            return
        }
        const fallbackCreator = buildFallbackCreator(currentUser)
        const locationIdByName = new Map(
            (locationRecords.value ?? []).map((location) => [
                location.name.toLowerCase(),
                location.id,
            ]),
        )
        const walls = await listWalls(
            gymId.value,
            {},
            { fields: 'id,name,location' },
        )
        const wallIdByKey = new Map(
            walls.map((wall) => [wallKey(wall.location, wall.name), wall.id]),
        )
        let failedRoutes = 0
        let failedRatings = 0

        for (const route of jsonData) {
            try {
                const createdRoute = await createRoute(
                    gymId.value,
                    sanitizeRoutePayload(
                        route,
                        fallbackCreator,
                        locationIdByName,
                        wallIdByKey,
                    ),
                )
                if (route.source_id) {
                    sourceIds.set(route.source_id, createdRoute.id)
                }

                if (Array.isArray(route.ratings) && route.ratings.length > 0) {
                    failedRatings += await postRatings(
                        route.ratings.map((rating) =>
                            sanitizeRatingPayload(rating, {
                                routeId: createdRoute.id,
                                routeType: route.type,
                            }),
                        ),
                    )
                }
            } catch (routeError) {
                console.error('Failed to insert route', routeError)
                failedRoutes++
            }
        }

        notifyResult([
            ...(failedRoutes
                ? [
                      t(
                          'importRoutes.routesFailed',
                          { count: failedRoutes },
                          failedRoutes,
                      ),
                  ]
                : []),
            ...(failedRatings
                ? [
                      t(
                          'importRoutes.commentsFailed',
                          { count: failedRatings },
                          failedRatings,
                      ),
                  ]
                : []),
        ])

        emit('closed')
    } catch (error) {
        console.error('Error during import:', error)
        notifyError(t('importRoutes.failed'))
    } finally {
        loading.value = false
        cancelImport()
    }
}

function importedPosition(value: unknown) {
    const position = Number(value)
    return value !== null && Number.isFinite(position) ? position : 0.5
}

function wallKey(locationId: string, name: string) {
    return `${locationId}:${name.trim().toLowerCase()}`
}

function sanitizeRoutePayload(
    route: ImportedRoute,
    fallbackCreator: string,
    locationIdByName: Map<string, string>,
    wallIdByKey: Map<string, string>,
) {
    const normalizedCreators = normalizeCreators(route.creator)
    const location =
        typeof route.location === 'string'
            ? (locationIdByName.get(route.location.trim().toLowerCase()) ??
              null)
            : null
    const wall =
        location && typeof route.wall === 'string'
            ? (wallIdByKey.get(wallKey(location, route.wall)) ?? '')
            : ''

    return {
        name: typeof route.name === 'string' ? route.name : '',
        ...resolveImportedGrading(route, gradeSystemFor(route.type)),
        anchor_point: Number.isFinite(Number(route.anchor_point))
            ? Number(route.anchor_point)
            : null,
        location,
        wall,
        wall_position: wall ? importedPosition(route.wall_position) : null,
        type: route.type || null,
        comment: typeof route.comment === 'string' ? route.comment : '',
        creator:
            normalizedCreators.length > 0
                ? normalizedCreators
                : fallbackCreator
                  ? [fallbackCreator]
                  : [],
        screw_date: route.screw_date || null,
        color: route.color || null,
        archived: Boolean(route.archived),
    }
}

function sanitizeRatingPayload(
    rating: ImportedRating,
    meta: { routeId: string; routeType?: string | null },
) {
    return {
        route_id: meta.routeId,
        rating:
            rating.rating !== null &&
            rating.rating !== undefined &&
            rating.rating !== '' &&
            Number.isFinite(Number(rating.rating))
                ? Number(rating.rating)
                : null,
        ...resolveImportedGrading(
            {
                ...rating,
                grade_system:
                    rating.grade_system ??
                    (rating.grade ? gradeSystemFor(meta.routeType) : undefined),
                difficulty_sign:
                    rating.difficulty_sign === false
                        ? null
                        : rating.difficulty_sign,
            },
            gradeSystemFor(meta.routeType),
        ),
        comment: typeof rating.comment === 'string' ? rating.comment : '',
        created: typeof rating.created === 'string' ? rating.created : null,
    }
}

function buildFallbackCreator(user: UserRecord | null) {
    if (!user) {
        return t('importRoutes.importedSetter')
    }

    const candidates = [
        user.name,
        `${user.firstname ?? ''} ${user.lastname ?? ''}`.trim(),
        user.username,
        user.email,
    ].filter((value) => typeof value === 'string' && value.trim())

    return candidates[0] || t('importRoutes.importedSetter')
}
</script>
