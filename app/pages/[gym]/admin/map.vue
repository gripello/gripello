<template>
    <div class="map-screen map-editor-page">
        <div class="map-screen__bar" data-testid="map-editor-toolbar">
            <h1 class="map-screen__title">{{ $t('mapEditor.title') }}</h1>
            <USelect
                v-model="locationId"
                :items="locationItems"
                label-key="title"
                :aria-label="$t('climbing.location')"
                variant="soft"
                class="editor-location"
                data-testid="map-editor-location"
            />
            <template v-if="hasMap">
                <UButton
                    icon="i-lucide-undo-2"
                    color="neutral"
                    variant="ghost"
                    :disabled="!editor.canUndo.value"
                    :aria-label="$t('mapEditor.undo')"
                    :title="$t('mapEditor.undo')"
                    data-testid="map-editor-undo"
                    @click="editor.undo()"
                />
                <UButton
                    icon="i-lucide-redo-2"
                    color="neutral"
                    variant="ghost"
                    :disabled="!editor.canRedo.value"
                    :aria-label="$t('mapEditor.redo')"
                    :title="$t('mapEditor.redo')"
                    data-testid="map-editor-redo"
                    @click="editor.redo()"
                />
                <UButton
                    :icon="preview ? 'i-lucide-pencil' : 'i-lucide-eye'"
                    color="neutral"
                    variant="ghost"
                    :aria-label="
                        preview
                            ? $t('mapEditor.backToEditing')
                            : $t('mapEditor.preview')
                    "
                    :title="
                        preview
                            ? $t('mapEditor.backToEditing')
                            : $t('mapEditor.preview')
                    "
                    data-testid="map-editor-preview"
                    @click="preview = !preview"
                />
                <UButton
                    color="primary"
                    variant="solid"
                    icon="i-lucide-save"
                    :disabled="!editor.isDirty.value || !!incompleteWall"
                    :loading="saving"
                    data-testid="map-editor-save"
                    @click="save"
                >
                    {{ $t('mapEditor.save') }}
                </UButton>
            </template>
        </div>

        <LayoutEmptyState
            v-if="!locations.length"
            :title="$t('mapEditor.noLocations')"
        />

        <div
            v-else-if="!hasMap"
            class="setup-card m-4 rounded-lg border bg-default"
            data-testid="map-editor-setup"
        >
            <div class="p-4">
                <p class="text-sm font-medium font-semibold mb-1">
                    {{ $t('mapEditor.setupTitle') }}
                </p>
                <p class="text-xs text-muted mb-4">
                    {{ $t('mapEditor.setupIntro') }}
                </p>
                <form class="setup-row" @submit.prevent="createFloorPlan">
                    <UFormField
                        :label="$t('mapEditor.width')"
                        class="setup-field"
                    >
                        <UInput
                            v-model.number="setupWidth"
                            type="number"
                            :min="MAP_LIMITS.minSize"
                            :max="MAP_LIMITS.maxSize"
                            class="w-full"
                            data-testid="map-editor-setup-width"
                        >
                            <template #trailing>
                                <span class="text-xs text-muted">m</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        :label="$t('mapEditor.height')"
                        class="setup-field"
                    >
                        <UInput
                            v-model.number="setupHeight"
                            type="number"
                            :min="MAP_LIMITS.minSize"
                            :max="MAP_LIMITS.maxSize"
                            class="w-full"
                            data-testid="map-editor-setup-height"
                        >
                            <template #trailing>
                                <span class="text-xs text-muted">m</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UButton
                        type="submit"
                        color="primary"
                        class="self-end"
                        :disabled="!validSetupSize"
                        data-testid="map-editor-create"
                    >
                        {{ $t('mapEditor.create') }}
                    </UButton>
                </form>
            </div>
        </div>

        <div v-else class="map-screen__body">
            <div class="map-screen__stage">
                <MapView
                    v-if="preview"
                    :map="editor.state.value.map"
                    :walls="previewWalls"
                    :routes="previewRoutes"
                    :inset-bottom="sheetCover"
                />
                <MapEditorCanvas
                    v-else
                    ref="canvasRef"
                    :editor="editor"
                    :inset-bottom="sheetCover"
                    :grid="grid"
                    :trace-url="traceUrl"
                />
                <div v-if="!preview" class="map-screen__chips editor-tools">
                    <UFieldGroup
                        class="editor-tools__toggle shadow-[0_1px_3px_rgb(0_0_0/0.2)]"
                    >
                        <UButton
                            v-for="option in toolOptions"
                            :key="option.key"
                            size="lg"
                            :color="
                                activeToolKey === option.key
                                    ? 'primary'
                                    : 'neutral'
                            "
                            :variant="
                                activeToolKey === option.key
                                    ? 'solid'
                                    : 'outline'
                            "
                            :icon="option.icon"
                            square
                            class="md:px-3"
                            :aria-label="option.label"
                            :aria-pressed="activeToolKey === option.key"
                            :title="option.label"
                            :data-testid="`map-editor-tool-${option.key}`"
                            @click="option.select()"
                        >
                            <span class="hidden md:inline">{{
                                option.label
                            }}</span>
                        </UButton>
                    </UFieldGroup>
                    <UDropdownMenu
                        :items="gridMenuItems"
                        :content="{ align: 'start' }"
                    >
                        <UButton
                            size="lg"
                            color="neutral"
                            variant="outline"
                            icon="i-lucide-grid-3x3"
                            trailing-icon="i-lucide-chevron-down"
                            class="editor-tools__grid shadow-[0_1px_3px_rgb(0_0_0/0.2)] rounded-full"
                            data-testid="map-editor-grid"
                        >
                            {{ gridLabel }}
                        </UButton>
                    </UDropdownMenu>
                </div>
            </div>
            <MapSheet
                v-model:snap="sheetSnap"
                data-testid="map-editor-sheet"
                @cover="sheetCover = $event"
            >
                <template #header>
                    <span
                        class="editor-hint text-xs"
                        :class="
                            incompleteWall && editor.tool.value === 'select'
                                ? 'text-warning'
                                : 'text-muted'
                        "
                        aria-live="polite"
                        data-testid="map-editor-hint"
                    >
                        {{ hint }}
                    </span>
                    <UButton
                        v-if="canFinish"
                        color="primary"
                        variant="soft"
                        size="sm"
                        icon="i-lucide-check"
                        data-testid="map-editor-finish"
                        @click="canvasRef?.finishDraft()"
                    >
                        {{ $t('mapEditor.finish') }}
                    </UButton>
                    <UButton
                        v-if="editor.selectedVertex.value && !isDrawing"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        icon="i-lucide-trash-2"
                        data-testid="map-editor-delete-point"
                        @click="canvasRef?.removeSelectedVertex()"
                    >
                        {{ $t('mapEditor.deletePoint') }}
                    </UButton>
                </template>
                <MapEditorPanel
                    :editor="editor"
                    :has-trace="!!location?.map_trace"
                    :trace-busy="traceBusy"
                    :walls-with-routes="wallsWithRoutes"
                    @upload-trace="uploadTrace"
                    @remove-trace="removeTrace"
                />
            </MapSheet>
        </div>

        <ConfirmDialog
            v-model="discardDialogOpen"
            :title="$t('account.unsavedChanges')"
            :message="$t('mapEditor.discard')"
            :confirm-text="$t('mapPlacement.discard')"
            @confirm="settleDiscard(true)"
        />
    </div>
</template>

<script setup lang="ts">
import type {
    LocationRecord,
    RouteScoreRecord,
    WallRecord,
} from '~/types/models'
import {
    DEFAULT_MAP_HEIGHT,
    DEFAULT_MAP_WIDTH,
    MAP_LIMITS,
    sanitizeGymMap,
    sanitizeWall,
    type MapShapeKind,
} from '#shared/utils/mapGeometry'
import {
    newFloorPlan,
    wallChanges,
    wallProblems,
    type EditorState,
    type EditorWall,
} from '~/utils/mapEditor'
import type { SheetSnap } from '~/components/map/Sheet.vue'
import { cacheKeys } from '~/utils/realtimeCache'

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_settings',
})

const { t } = useI18n()
const pb = usePocketbase()
const editor = useMapEditor()

useSeoMeta({ title: () => t('page.title.mapEditor') })

const {
    locations,
    refreshLocations,
    locationItems,
    locationId,
    location,
    walls: wallRecords,
    refreshWalls,
} = await useGymMapLocation('map-editor', {
    includeUnmapped: true,
    confirmLeave: () => confirmDiscard(),
})

const { data: locationRoutes } = useAsyncData(
    cacheKeys.mapEditorRoutes,
    () =>
        locationId.value
            ? pb.collection('averageRating').getFullList<RouteScoreRecord>({
                  filter: pb.filter(
                      'archived = false && location = {:id} && wall != ""',
                      { id: locationId.value },
                  ),
                  fields: 'id,name,color,wall,wall_position,type,grade,grade_system',
                  requestKey: 'mapEditorRoutes',
              })
            : Promise.resolve([]),
    { watch: [locationId], default: () => [], server: false },
)
useLiveLocation([cacheKeys.mapEditorRoutes], locationId)

const savedMap = computed(() => sanitizeGymMap(location.value?.map))
const hasMap = computed(() => !!savedMap.value || editor.isDirty.value)

function toEditorState(
    record: LocationRecord | undefined,
    walls: WallRecord[],
): EditorState | null {
    const map = sanitizeGymMap(record?.map)
    if (!map) return null
    return {
        map,
        walls: walls.flatMap((wall) => {
            const geometry = sanitizeWall(wall, map)
            return [
                {
                    key: wall.id,
                    id: wall.id,
                    name: wall.name,
                    sort: wall.sort ?? 0,
                    anchorFrom: wall.anchor_from || null,
                    anchorTo: wall.anchor_to || null,
                    outline: geometry?.outline ?? [],
                    edge: geometry?.edge ?? [],
                    label: geometry?.label ?? null,
                },
            ]
        }),
    }
}

const sortedById = (state: EditorState) =>
    JSON.stringify({
        ...state,
        walls: [...state.walls].sort((a, b) => a.key.localeCompare(b.key)),
    })

let loadedLocationId = ''

watch(
    [location, wallRecords],
    () => {
        const sameLocation = loadedLocationId === locationId.value
        if (sameLocation && editor.isDirty.value) return
        loadedLocationId = locationId.value
        const next = toEditorState(location.value, wallRecords.value) ?? {
            map: {
                width: DEFAULT_MAP_WIDTH,
                height: DEFAULT_MAP_HEIGHT,
                shapes: [],
            },
            walls: [],
        }
        if (sameLocation && sortedById(next) === sortedById(editor.state.value))
            return
        editor.load(next)
    },
    { immediate: true },
)

const setupWidth = ref(DEFAULT_MAP_WIDTH)
const setupHeight = ref(DEFAULT_MAP_HEIGHT)
const validSetupSize = computed(() =>
    [setupWidth.value, setupHeight.value].every(
        (size) => size >= MAP_LIMITS.minSize && size <= MAP_LIMITS.maxSize,
    ),
)

function createFloorPlan() {
    if (!validSetupSize.value) return
    editor.commit({
        map: newFloorPlan(setupWidth.value, setupHeight.value),
        walls: [],
    })
}

const canvasRef = useTemplateRef<{
    fitAll: (animate?: boolean) => void
    finishDraft: () => void
    removeSelectedVertex: () => boolean
}>('canvasRef')
const grid = ref(0.5)
const preview = ref(false)
const sheetSnap = ref<SheetSnap>('half')
const sheetCover = ref(0)
const gridLabel = computed(
    () => gridItems.value.find((item) => item.value === grid.value)?.title,
)
const gridMenuItems = computed(() =>
    gridItems.value.map((item) => ({
        label: item.title,
        type: 'checkbox' as const,
        checked: grid.value === item.value,
        onSelect: () => {
            grid.value = item.value
        },
    })),
)
const isDrawing = computed(() =>
    ['shape', 'outline', 'edge'].includes(editor.tool.value),
)
const canFinish = computed(
    () =>
        isDrawing.value &&
        editor.draft.value.length >= (editor.tool.value === 'edge' ? 2 : 3),
)
const gridItems = computed(() => [
    { title: t('mapEditor.gridOff'), value: 0 },
    { title: '0.25 m', value: 0.25 },
    { title: '0.5 m', value: 0.5 },
    { title: '1 m', value: 1 },
])

const drawShape = (kind: MapShapeKind) => () => {
    editor.shapeKind.value = kind
    editor.selectTool('shape')
}

const toolOptions = computed(() => [
    {
        key: 'select',
        icon: 'i-lucide-mouse-pointer-2',
        label: t('mapEditor.tools.select'),
        select: () => editor.selectTool('select'),
    },
    {
        key: 'floor',
        icon: 'i-lucide-land-plot',
        label: t('mapEditor.kinds.floor'),
        select: drawShape('floor'),
    },
    {
        key: 'mat',
        icon: 'i-lucide-rectangle-horizontal',
        label: t('mapEditor.kinds.mat'),
        select: drawShape('mat'),
    },
    {
        key: 'structure',
        icon: 'i-lucide-box',
        label: t('mapEditor.kinds.structure'),
        select: drawShape('structure'),
    },
])

const activeToolKey = computed(() =>
    editor.tool.value === 'shape' ? editor.shapeKind.value : 'select',
)

const incompleteWall = computed(() =>
    editor.state.value.walls.find((wall) => wallProblems(wall).length),
)

function missingText(wall: EditorWall) {
    return wallProblems(wall)
        .map((problem) => t(`mapEditor.missing.${problem}`))
        .join(', ')
}

const hint = computed(() => {
    const tool = editor.tool.value
    const name = editor.selectedWall.value?.name ?? ''
    if (tool === 'shape') return t('mapEditor.hints.polygon')
    if (tool === 'outline') return t('mapEditor.hints.outline', { name })
    if (tool === 'edge') return t('mapEditor.hints.edge', { name })
    if (tool === 'label') return t('mapEditor.hints.label')
    if (incompleteWall.value)
        return t('mapEditor.hints.incomplete', {
            name: incompleteWall.value.name,
            missing: missingText(incompleteWall.value),
        })
    if (editor.selection.value) return t('mapEditor.hints.selected')
    return t('mapEditor.hints.select')
})

const previewWalls = computed<WallRecord[]>(() =>
    editor.state.value.walls
        .filter((wall) => !wallProblems(wall).length)
        .map((wall) => ({
            id: wall.id ?? wall.key,
            location: locationId.value,
            name: wall.name,
            outline: wall.outline,
            edge: wall.edge,
            label: wall.label,
            sort: wall.sort,
            anchor_from: wall.anchorFrom,
            anchor_to: wall.anchorTo,
        })),
)
const previewRoutes = computed(() => locationRoutes.value)
const wallsWithRoutes = computed(
    () => new Set(locationRoutes.value.map((route) => route.wall ?? '')),
)

const { pending: traceBusy, run: runTrace } = useAsyncAction()
const traceUrl = computed(() =>
    location.value?.map_trace
        ? usePbFileUrl(location.value, location.value.map_trace)
        : null,
)

async function uploadTrace(file: File) {
    if (!location.value) return
    const locationRecordId = location.value.id
    await runTrace(async () => {
        await pb
            .collection('locations')
            .update(locationRecordId, { map_trace: file })
        await refreshLocations()
        const map = editor.state.value.map
        if (!map.trace)
            editor.commit({
                ...editor.state.value,
                map: {
                    ...map,
                    trace: { x: 0, y: 0, width: map.width, opacity: 0.5 },
                },
            })
    })
}

async function removeTrace() {
    if (!location.value) return
    const locationRecordId = location.value.id
    await runTrace(async () => {
        await pb
            .collection('locations')
            .update(locationRecordId, { map_trace: null })
        await refreshLocations()
        const { trace: _removed, ...map } = editor.state.value.map
        editor.commit({ ...editor.state.value, map })
    })
}

const { pending: saving, run: runSave } = useAsyncAction()

function wallPayload(wall: EditorWall) {
    return {
        location: locationId.value,
        name: wall.name.trim(),
        outline: wall.outline,
        edge: wall.edge,
        label: wall.label,
        sort: wall.sort,
        anchor_from: wall.anchorFrom,
        anchor_to: wall.anchorTo,
    }
}

async function save() {
    if (saving.value || !location.value) return
    const state = editor.state.value
    const broken = incompleteWall.value
    if (broken) {
        editor.selectTool('select')
        editor.selection.value = { kind: 'wall', key: broken.key }
        return
    }

    const changes = wallChanges(editor.saved.value.walls, state.walls)
    const batch = pb.createBatch()
    batch.collection('locations').update(location.value.id, { map: state.map })
    for (const wall of changes.create)
        batch.collection('walls').create(wallPayload(wall))
    for (const wall of changes.update)
        batch.collection('walls').update(wall.id!, wallPayload(wall))
    for (const id of changes.remove) batch.collection('walls').delete(id)

    await runSave(
        async () => {
            const results = await batch.send()
            const createdIds = results
                .slice(1, 1 + changes.create.length)
                .map((result) => (result.body as { id: string }).id)
            const idByKey = new Map(
                changes.create.map((wall, index) => [
                    wall.key,
                    createdIds[index]!,
                ]),
            )
            const next: EditorState = {
                ...state,
                walls: state.walls.map((wall) => {
                    const id = idByKey.get(wall.key)
                    return id ? { ...wall, id, key: id } : wall
                }),
            }
            const selected = editor.selection.value
            editor.markSaved(next)
            if (selected?.kind === 'wall' && idByKey.has(selected.key))
                editor.selection.value = {
                    kind: 'wall',
                    key: idByKey.get(selected.key)!,
                }
            await Promise.all([refreshLocations(), refreshWalls()])
        },
        {
            success: t('mapEditor.saved'),
            error: t('mapEditor.saveFailed'),
        },
    )
}

const { discardDialogOpen, confirmDiscard, settleDiscard } = useDiscardConfirm(
    () => editor.isDirty.value,
)

onBeforeRouteLeave(() => confirmDiscard())

function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!editor.isDirty.value) return
    event.preventDefault()
}

function isTyping(target: EventTarget | null) {
    const element = target as HTMLElement | null
    return (
        !!element &&
        (element.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
    )
}

function onKeyDown(event: KeyboardEvent) {
    if (isTyping(event.target) || preview.value || !hasMap.value) return
    const key = event.key.toLowerCase()
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && key === 'z') {
        if (event.shiftKey) editor.redo()
        else editor.undo()
    } else if (modifier && key === 'y') editor.redo()
    else if (modifier && key === 's') void save()
    else if (key === 'enter') canvasRef.value?.finishDraft()
    else if (key === 'escape') {
        if (editor.draft.value.length || editor.tool.value !== 'select')
            editor.selectTool('select')
        else editor.selection.value = null
    } else if (key === 'delete' || key === 'backspace') {
        canvasRef.value?.removeSelectedVertex()
    } else return
    event.preventDefault()
}

onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.editor-location {
    flex: 0 1 220px;
    min-width: 0;
}

.setup-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    max-width: 520px;
}

.setup-field {
    flex: 1 1 140px;
}

.editor-tools {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 2px 2px 6px;
}

.editor-tools__toggle,
.editor-tools__grid {
    flex-shrink: 0;
}

.editor-hint {
    flex: 1 1 auto;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

@variant max-sm {
    .map-screen__title {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }

    .editor-location {
        flex: 1 1 auto;
    }
}
</style>
