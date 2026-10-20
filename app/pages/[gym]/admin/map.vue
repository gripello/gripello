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
                class="min-w-0 flex-1 basis-0 sm:max-w-[220px] sm:flex-none sm:basis-[220px]"
                data-testid="map-editor-location"
            />
            <template v-if="hasMap">
                <UButton
                    class="icon-btn"
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
                    class="icon-btn max-sm:hidden"
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
                    class="icon-btn"
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
                    {{
                        changeCount
                            ? $t('mapEditor.saveCount', { n: changeCount })
                            : $t('mapEditor.save')
                    }}
                </UButton>
                <UDropdownMenu :items="moreItems" :content="{ align: 'end' }">
                    <UButton
                        class="icon-btn"
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        :aria-label="$t('actions.more')"
                        data-testid="map-editor-more"
                    />
                </UDropdownMenu>
            </template>
        </div>

        <LayoutEmptyState
            v-if="!locations.length"
            icon="i-lucide-map"
            :title="$t('mapEditor.noLocations')"
        >
            <template #actions>
                <UButton
                    color="primary"
                    icon="i-lucide-plus"
                    :to="{
                        path: gymPath('/admin/settings'),
                        query: { section: 'locations' },
                    }"
                    data-testid="map-editor-add-location"
                >
                    {{ $t('mapEditor.addLocation') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <LayoutPanel
            v-else-if="!hasMap"
            :title="$t('mapEditor.setupTitle')"
            class="m-4"
            data-testid="map-editor-setup"
        >
            <form class="setup-row" @submit.prevent="createFloorPlan">
                <UFormField :label="$t('mapEditor.width')" class="setup-field">
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
                <UFormField :label="$t('mapEditor.height')" class="setup-field">
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
        </LayoutPanel>

        <div v-else class="map-screen__body">
            <nav
                v-if="mdAndUp && !preview"
                class="editor-rail"
                :aria-label="$t('mapEditor.tools.label')"
            >
                <SegmentedControl
                    v-model="activeTool"
                    :items="railItems"
                    orientation="vertical"
                />
            </nav>
            <div class="map-screen__stage">
                <MapView
                    v-if="preview"
                    :map="editor.state.value.map"
                    :walls="previewWalls"
                    :routes="previewRoutes"
                    :selected-wall-id="previewWallId"
                    :selected-route-id="previewRouteId"
                    :inset-bottom="sheetCover"
                    @select-wall="selectPreviewWall"
                    @select-route="selectPreviewRoute"
                />
                <MapEditorCanvas
                    v-else
                    :editor="editor"
                    :inset-bottom="sheetCover"
                    :grid="grid"
                    :trace-url="traceUrl"
                />
                <div v-if="!preview" class="editor-overlay">
                    <UAlert
                        v-if="remoteState && editor.isDirty.value"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-refresh-cw"
                        :title="$t('mapEditor.changedElsewhere')"
                        :actions="[
                            {
                                label: $t('mapEditor.reload'),
                                color: 'warning',
                                variant: 'solid',
                                onClick: reloadRemote,
                            },
                            {
                                label: $t('mapEditor.keepMine'),
                                color: 'neutral',
                                variant: 'ghost',
                                onClick: () => (remoteState = null),
                            },
                        ]"
                        orientation="horizontal"
                        class="editor-remote"
                        data-testid="map-editor-changed-elsewhere"
                    />
                    <MapEditorBar
                        :editor="editor"
                        :incomplete-wall="incompleteWall"
                    />
                </div>
                <div
                    v-if="!mdAndUp && !preview"
                    class="editor-phone-tools"
                    :style="{ bottom: `${sheetCover + 12}px` }"
                >
                    <SegmentedControl v-model="activeTool" :items="toolItems" />
                </div>
            </div>
            <MapSheet
                v-model:snap="sheetSnap"
                data-testid="map-editor-sheet"
                @cover="sheetCover = $event"
            >
                <template #header>
                    <span class="flex-1 truncate text-sm font-medium">
                        {{
                            preview
                                ? (previewWall?.name ?? $t('mapEditor.preview'))
                                : $t('mapEditor.panel')
                        }}
                    </span>
                </template>
                <MapRouteList
                    v-if="preview"
                    :groups="previewGroups"
                    :show-headings="!previewWallId"
                    :ticked-ids="noTicks"
                    :selected-route-id="previewRouteId"
                    data-testid="map-editor-preview-list"
                    @select="selectPreviewRoute"
                />
                <MapEditorPanel
                    v-else
                    :editor="editor"
                    :has-trace="!!traceUrl"
                    :route-counts="routeCounts"
                    :save-errors="saveErrors"
                    @upload-trace="uploadTrace"
                    @remove-trace="removeTrace"
                />
            </MapSheet>
        </div>

        <LayoutDialogShell
            v-model="shortcutsOpen"
            :title="$t('mapEditor.shortcuts.title')"
            closable
            data-testid="map-editor-shortcuts"
        >
            <ul class="divide-y divide-default text-sm">
                <li
                    v-for="shortcut in shortcuts"
                    :key="shortcut.label"
                    class="flex items-center gap-3 py-2"
                >
                    <span class="flex-1">{{ shortcut.label }}</span>
                    <span class="flex gap-1">
                        <UKbd v-for="key in shortcut.keys" :key="key">
                            {{ key }}
                        </UKbd>
                    </span>
                </li>
            </ul>
        </LayoutDialogShell>

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
import { isTypingTarget } from '~/utils/keyboard'
import { useEventListener } from '@vueuse/core'
import { fileUrl } from '~/api/client'
import {
    deleteMapTrace,
    listRoutes,
    saveFloorPlan,
    uploadMapTrace,
} from '~/api/routes'
import type { LocationRecord, WallRecord } from '~/types/models'
import {
    DEFAULT_MAP_HEIGHT,
    DEFAULT_MAP_WIDTH,
    MAP_LIMITS,
    MAP_SHAPE_KINDS,
    sanitizeGymMap,
    sanitizeWall,
    type MapShapeKind,
} from '#shared/utils/mapGeometry'
import type { DropdownMenuItem } from '@nuxt/ui'
import {
    dropTrace,
    floorPlanErrors,
    newFloorPlan,
    stageTrace,
    TRACE_MAX_BYTES,
    TRACE_TYPES,
    nextWallName,
    wallChanges,
    wallProblems,
    type EditorState,
    type EditorWall,
    type FloorPlanError,
    type TraceChange,
} from '~/utils/mapEditor'
import type { SheetSnap } from '~/components/map/Sheet.vue'
import { routesOnWall } from '~/utils/gymMap'
import { normalizeCreators } from '#shared/utils/formatting'
import { cacheKeys } from '~/utils/realtimeCache'

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_settings',
})

const { t } = useI18n()
const gymId = useCurrentGymId()
const gymPath = useGymPath()
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
            ? listRoutes(gymId.value, {
                  location: locationId.value,
                  wall: 'any',
              }).then((list) => list.items)
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
const remoteState = shallowRef<EditorState | null>(null)

watch(
    [location, wallRecords],
    () => {
        const sameLocation = loadedLocationId === locationId.value
        const next = toEditorState(location.value, wallRecords.value) ?? {
            map: {
                width: DEFAULT_MAP_WIDTH,
                height: DEFAULT_MAP_HEIGHT,
                shapes: [],
            },
            walls: [],
        }
        if (sameLocation) {
            if (sortedById(next) === sortedById(editor.saved.value)) {
                remoteState.value = null
                return
            }
            if (editor.isDirty.value || editor.isDrawing.value) {
                remoteState.value = next
                return
            }
        }
        loadedLocationId = locationId.value
        remoteState.value = null
        editor.load(next)
    },
    { immediate: true },
)

watch(editor.isDrawing, (drawing) => {
    if (!drawing && remoteState.value && !editor.isDirty.value) reloadRemote()
})

function reloadRemote() {
    if (remoteState.value) editor.load(remoteState.value)
    remoteState.value = null
}

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

const { mdAndUp, xs } = useDisplay()
const grid = ref(0.5)
const preview = ref(false)
const sheetSnap = ref<SheetSnap>('half')
const sheetCover = ref(0)
const gridItems = computed(() => [
    { title: t('mapEditor.gridOff'), value: 0 },
    { title: '0.25 m', value: 0.25 },
    { title: '0.5 m', value: 0.5 },
    { title: '1 m', value: 1 },
])
const shortcutsOpen = ref(false)
const shortcuts = computed(() => [
    { label: t('mapEditor.undo'), keys: ['Ctrl', 'Z'] },
    { label: t('mapEditor.redo'), keys: ['Ctrl', '⇧', 'Z'] },
    { label: t('mapEditor.save'), keys: ['Ctrl', 'S'] },
    { label: t('mapEditor.finish'), keys: ['Enter'] },
    { label: t('actions.cancel'), keys: ['Esc'] },
    { label: t('mapEditor.deletePoint'), keys: ['Del'] },
    { label: t('mapEditor.shortcuts.pan'), keys: ['←', '→', '↑', '↓'] },
    { label: t('mapEditor.shortcuts.zoom'), keys: ['+', '−'] },
])
const moreItems = computed<DropdownMenuItem[]>(() => [
    ...(xs.value
        ? [
              {
                  label: t('mapEditor.redo'),
                  icon: 'i-lucide-redo-2',
                  disabled: !editor.canRedo.value,
                  onSelect: () => editor.redo(),
              },
          ]
        : []),
    {
        label: t('mapEditor.grid'),
        icon: 'i-lucide-grid-3x3',
        children: gridItems.value.map((item) => ({
            label: item.title,
            type: 'checkbox' as const,
            checked: grid.value === item.value,
            onSelect: () => {
                grid.value = item.value
            },
        })),
    },
    {
        label: t('mapEditor.shortcuts.title'),
        icon: 'i-lucide-keyboard',
        onSelect: () => {
            shortcutsOpen.value = true
        },
    },
])

let snapBeforeDrawing: SheetSnap | null = null
watch(editor.isDrawing, (drawing) => {
    if (drawing && sheetSnap.value !== 'peek') {
        snapBeforeDrawing = sheetSnap.value
        sheetSnap.value = 'peek'
    } else if (!drawing && snapBeforeDrawing) {
        sheetSnap.value = snapBeforeDrawing
        snapBeforeDrawing = null
    }
})

type ToolKey = 'select' | 'wall' | 'trace' | MapShapeKind

const toolItems = computed(() =>
    (
        [
            ['select', 'i-lucide-mouse-pointer-2', t('mapEditor.tools.select')],
            ['wall', 'i-lucide-pen-line', t('mapEditor.tools.wall')],
            ...MAP_SHAPE_KINDS.map(
                (kind) =>
                    [
                        kind,
                        SHAPE_ICONS[kind],
                        t(`mapEditor.kinds.${kind}`),
                    ] as const,
            ),
        ] as const
    ).map(([value, icon, label]) => ({
        value: value as ToolKey,
        icon,
        label,
        testId: `map-editor-tool-${value}`,
    })),
)

const railItems = computed(() => [
    ...toolItems.value,
    {
        value: 'trace' as ToolKey,
        icon: 'i-lucide-image',
        label: t('mapEditor.tools.trace'),
        testId: 'map-editor-tool-trace',
    },
])

const activeTool = computed<ToolKey>({
    get: () => {
        const tool = editor.tool.value
        if (tool === 'shape') return editor.shapeKind.value
        if (tool === 'select' || tool === 'trace') return tool
        return 'wall'
    },
    set: (key) => {
        if (key === 'select' || key === 'trace') editor.selectTool(key)
        else if (key === 'wall') startWall()
        else {
            editor.shapeKind.value = key
            editor.selectTool('shape')
        }
    },
})

function startWall() {
    const wall = editor.selectedWall.value
    const missing = wall ? wallProblems(wall) : []
    if (wall && missing.includes('outline')) editor.selectTool('outline')
    else if (wall && missing.includes('edge')) editor.selectTool('edge')
    else
        editor.addNewWall(
            nextWallName(editor.state.value.walls, (n) =>
                t('mapEditor.defaultWallName', { n }),
            ),
        )
}

const incompleteWall = computed(() =>
    editor.state.value.walls.find(
        (wall) => wallProblems(wall, editor.state.value.walls).length,
    ),
)

const changeCount = computed(() => {
    if (!editor.isDirty.value) return 0
    const saved = editor.saved.value
    const changes = wallChanges(saved.walls, editor.state.value.walls)
    const mapChanged =
        JSON.stringify(saved.map) !== JSON.stringify(editor.state.value.map) ||
        !!editor.state.value.trace
    return (
        changes.create.length +
            changes.update.length +
            changes.remove.length +
            (mapChanged ? 1 : 0) || 1
    )
})

const previewWalls = computed(() =>
    editor.state.value.walls
        .filter((wall) => !wallProblems(wall).length)
        .map((wall) => ({
            id: wall.id ?? wall.key,
            name: wall.name,
            outline: wall.outline,
            edge: wall.edge,
            label: wall.label,
            sort: wall.sort,
        })),
)
const previewRoutes = computed(() => locationRoutes.value)
const previewWallId = ref<string | null>(null)
const previewRouteId = ref<string | null>(null)
const noTicks: ReadonlySet<string> = new Set()
const previewWall = computed(() =>
    previewWalls.value.find((wall) => wall.id === previewWallId.value),
)
const previewGroups = computed(() =>
    previewWalls.value
        .filter(
            (wall) => !previewWallId.value || wall.id === previewWallId.value,
        )
        .map((wall) => ({
            id: wall.id,
            name: wall.name,
            routes: routesOnWall(locationRoutes.value, wall.id).map(
                (route) => ({
                    ...route,
                    creator: normalizeCreators(route.creator),
                }),
            ),
        }))
        .filter((group) => group.routes.length),
)

watch(preview, () => {
    previewWallId.value = null
    previewRouteId.value = null
})

function selectPreviewWall(wallId: string | null) {
    previewWallId.value = wallId
    previewRouteId.value = null
}

function selectPreviewRoute(routeId: string) {
    previewRouteId.value = routeId
    previewWallId.value =
        locationRoutes.value.find((route) => route.id === routeId)?.wall ??
        previewWallId.value
}
const routeCounts = computed(() => {
    const counts = new Map<string, number>()
    for (const route of locationRoutes.value)
        if (route.wall)
            counts.set(route.wall, (counts.get(route.wall) ?? 0) + 1)
    return counts
})

const traceFiles = new Map<string, { file: File; url: string }>()
const { error: notifyError } = useNotification()

const traceUrl = computed(() => {
    const change = editor.state.value.trace
    if (change && 'file' in change)
        return traceFiles.get(change.file)?.url ?? null
    if (change?.removed || !location.value?.map_trace) return null
    return fileUrl('locations', location.value, location.value.map_trace)
})

function uploadTrace(file: File) {
    if (!TRACE_TYPES.includes(file.type) || file.size > TRACE_MAX_BYTES) {
        notifyError(t('mapEditor.traceInvalid'))
        return
    }
    const key = `trace-${Date.now()}`
    traceFiles.set(key, { file, url: URL.createObjectURL(file) })
    editor.commit(stageTrace(editor.state.value, key))
}

function removeTrace() {
    editor.commit(dropTrace(editor.state.value))
}

async function saveTrace(locationRecordId: string, change: TraceChange) {
    if ('file' in change) {
        const staged = traceFiles.get(change.file)
        if (staged) await uploadMapTrace(locationRecordId, staged.file)
    } else if (location.value?.map_trace) {
        await deleteMapTrace(locationRecordId)
    }
}

onBeforeUnmount(() => {
    for (const { url } of traceFiles.values()) URL.revokeObjectURL(url)
})

const { pending: saving, run: runSave } = useAsyncAction()
const saveErrors = ref<FloorPlanError[]>([])
const saveErrorText = useFloorPlanErrorText()

watch(editor.state, () => {
    saveErrors.value = []
})

function explainSaveError(
    error: unknown,
    sent: { walls: EditorWall[]; removed: EditorWall[] },
) {
    saveErrors.value = floorPlanErrors(error, sent)
    const [first] = saveErrors.value
    if (!first) return t('mapEditor.saveFailed')
    if (first.key) {
        editor.selectTool('select')
        editor.selection.value = { kind: 'wall', key: first.key }
    }
    return `${first.name}: ${saveErrorText(first)}`
}

function wallPayload(wall: EditorWall) {
    return {
        location: locationId.value,
        name: wall.name.trim(),
        outline: wall.outline,
        edge: wall.edge,
        label: wall.label,
        sort: wall.sort,
        anchor_from: wall.anchorFrom ?? 0,
        anchor_to: wall.anchorTo ?? 0,
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
    const locationRecordId = location.value.id
    const sent = {
        walls: [...changes.create, ...changes.update],
        removed: changes.remove.map((id) =>
            editor.saved.value.walls.find((wall) => wall.id === id)!,
        ),
    }

    await runSave(
        async () => {
            if (state.trace) await saveTrace(locationRecordId, state.trace)
            const saved = await saveFloorPlan(locationRecordId, {
                map: state.map,
                walls: sent.walls.map((wall) => ({
                    ...wallPayload(wall),
                    ...(wall.id ? { id: wall.id } : {}),
                })),
                removed: changes.remove,
            })
            const createdIds = saved.walls
                .slice(0, changes.create.length)
                .map((wall) => wall.id)
            const idByKey = new Map(
                changes.create.map((wall, index) => [
                    wall.key,
                    createdIds[index]!,
                ]),
            )
            const { trace: _sent, ...rest } = state
            const next: EditorState = {
                ...rest,
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
            error: (error) => explainSaveError(error, sent),
        },
    )
}

const { discardDialogOpen, confirmDiscard, settleDiscard, leaveGuard } =
    useDiscardConfirm(() => editor.isDirty.value)

onBeforeRouteLeave(leaveGuard)

function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!editor.isDirty.value) return
    event.preventDefault()
}

function onKeyDown(event: KeyboardEvent) {
    if (
        isTypingTarget(event.target) ||
        preview.value ||
        !hasMap.value ||
        discardDialogOpen.value ||
        shortcutsOpen.value
    )
        return
    const key = event.key.toLowerCase()
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && key === 'z') {
        if (event.shiftKey) editor.redo()
        else editor.undo()
    } else if (modifier && key === 'y') editor.redo()
    else if (modifier && key === 's') void save()
    else if (key === 'enter') editor.finishDraft()
    else if (key === 'escape') {
        if (editor.draft.value.length || editor.tool.value !== 'select')
            editor.selectTool('select')
        else editor.selection.value = null
    } else if (key === 'delete' || key === 'backspace') {
        editor.removeSelectedVertex()
    } else return
    event.preventDefault()
}

useEventListener('keydown', onKeyDown)
useEventListener('beforeunload', onBeforeUnload)
</script>

<style scoped>
@reference "~/assets/css/main.css";

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

.editor-overlay {
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.editor-remote {
    pointer-events: auto;
    max-width: 560px;
}

.editor-rail {
    flex: none;
    width: 96px;
    padding: 8px;
    border-right: 1px solid var(--ui-border);
    background: var(--ui-bg);
    overflow-y: auto;
}

.editor-overlay {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 68px;
    z-index: 2;
    display: flex;
    justify-content: center;
    pointer-events: none;
}

.editor-phone-tools {
    position: absolute;
    left: 12px;
    right: 12px;
    z-index: 2;
    display: flex;
    justify-content: center;
    padding: 4px;
    border-radius: calc(var(--ui-radius) * 3);
    background: var(--ui-bg);
    box-shadow:
        0 0 0 1px var(--ui-border),
        0 6px 16px rgb(0 0 0 / 0.12);
}

@variant max-sm {
    .map-screen__title {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }
}
</style>
