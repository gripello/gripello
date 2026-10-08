<template>
    <div>
        <input
            ref="fileInput"
            type="file"
            class="hidden"
            accept="application/json"
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

            <LayoutListGroup v-if="smAndDown" data-testid="import-route-list">
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
import { normalizeCreators } from '#shared/utils/formatting'
import {
    resolveImportedGrading,
    type ImportedGrading,
} from '#shared/utils/grades'
import type { TableColumn } from '@nuxt/ui'
import type { UserRecord, WallRecord } from '~/types/models'

interface ImportedRating extends ImportedGrading {
    rating?: unknown
    comment?: unknown
    user?: string
}

interface ImportedRoute extends ImportedGrading {
    name?: unknown
    anchor_point?: unknown
    location?: unknown
    type?: string | null
    comment?: unknown
    creator?: unknown
    screw_date?: string | null
    color?: string | null
    archived?: unknown
    wall?: unknown
    wall_position?: unknown
    ratings?: ImportedRating[]
    ratingsCount?: number
}

const pb = usePocketbase()
const gymId = useCurrentGymId()
const emit = defineEmits<{ closed: [] }>()
const currentUser = pb.authStore.record as UserRecord | null

const fileInput = ref<HTMLInputElement | null>(null)
const showPreviewDialog = ref(false)
const loading = ref(false)
const routesToImport = ref<ImportedRoute[]>([])
const expanded = ref<Record<string, boolean>>({})

const { t } = useI18n()
const { notify, error: notifyError } = useNotification()
const { data: locationRecords } = useLocations()
const { gradeSystemFor } = useGradeSystems()

const { smAndDown } = useDisplay()

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

const handleFileChange = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
        try {
            const parsedData = JSON.parse(String(reader.result))
            if (!Array.isArray(parsedData)) {
                throw new Error('JSON file is not an array.')
            }
            routesToImport.value = parsedData.map((route: ImportedRoute) => ({
                ...route,
                ratingsCount: route.ratings?.length || 0,
            }))
            showPreviewDialog.value = true
        } catch (error) {
            console.error('Error parsing JSON file:', error)
            notifyError(t('importRoutes.invalidJson'))
        }
    }
    reader.onerror = () => {
        notifyError(t('importRoutes.readFailed'))
    }
    reader.readAsText(file)

    input.value = ''
}

const cancelImport = () => {
    showPreviewDialog.value = false
    routesToImport.value = []
}

const confirmImport = async () => {
    loading.value = true
    const jsonData = routesToImport.value

    try {
        const fallbackCreator = buildFallbackCreator(currentUser)
        const locationIdByName = new Map(
            (locationRecords.value ?? []).map((location) => [
                location.name.toLowerCase(),
                location.id,
            ]),
        )
        const walls = await pb.collection('walls').getFullList<WallRecord>({
            filter: gymFilter(pb, gymId.value),
            fields: 'id,name,location',
        })
        const wallIdByKey = new Map(
            walls.map((wall) => [wallKey(wall.location, wall.name), wall.id]),
        )
        let failedRoutes = 0
        let failedRatings = 0

        for (const route of jsonData) {
            try {
                const createdRoute = await pb.collection('routes').create({
                    ...sanitizeRoutePayload(
                        route,
                        fallbackCreator,
                        locationIdByName,
                        wallIdByKey,
                    ),
                    gym: gymId.value,
                })

                if (Array.isArray(route.ratings) && route.ratings.length > 0) {
                    const ratings = route.ratings.map((rating) =>
                        sanitizeRatingPayload(rating, {
                            routeId: createdRoute.id,
                            routeType: route.type,
                            fallbackUserId: currentUser?.id,
                        }),
                    )
                    try {
                        const { failed } = await pb.send<{ failed: number }>(
                            '/api/import/ratings',
                            {
                                method: 'POST',
                                body: { gym: gymId.value, ratings },
                            },
                        )
                        failedRatings += failed
                    } catch (ratingError) {
                        console.error('Failed to insert ratings', ratingError)
                        failedRatings += ratings.length
                    }
                }
            } catch (routeError) {
                console.error('Failed to insert route', routeError)
                failedRoutes++
            }
        }

        if (failedRoutes === 0 && failedRatings === 0) {
            notify(t('importRoutes.success'))
        } else {
            const summaryParts: string[] = []
            if (failedRoutes > 0) {
                summaryParts.push(
                    t(
                        'importRoutes.routesFailed',
                        { count: failedRoutes },
                        failedRoutes,
                    ),
                )
            }
            if (failedRatings > 0) {
                summaryParts.push(
                    t(
                        'importRoutes.commentsFailed',
                        { count: failedRatings },
                        failedRatings,
                    ),
                )
            }
            notify(
                t('importRoutes.issues', { details: summaryParts.join(', ') }),
                'warning',
            )
        }

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
    meta: {
        routeId: string
        routeType?: string | null
        fallbackUserId?: string
    },
) {
    const userId = rating.user || meta.fallbackUserId
    return {
        route_id: meta.routeId,
        rating: Number.isFinite(Number(rating.rating))
            ? Number(rating.rating)
            : null,
        ...resolveImportedGrading(
            {
                ...rating,
                difficulty_sign:
                    rating.difficulty_sign === false
                        ? null
                        : rating.difficulty_sign,
            },
            gradeSystemFor(meta.routeType),
        ),
        comment: typeof rating.comment === 'string' ? rating.comment : '',
        ...(userId ? { user: userId } : {}),
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
