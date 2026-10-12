<template>
    <div class="editor-panel" data-testid="map-editor-panel">
        <LayoutTabs v-model="tab" :items="tabs" :unmount-on-hide="false">
            <template #walls>
                <div class="panel-tab">
                    <UButton
                        block
                        color="neutral"
                        variant="outline"
                        icon="i-lucide-plus"
                        data-testid="map-editor-add-wall"
                        @click="newWall"
                    >
                        {{ $t('mapEditor.newWall') }}
                    </UButton>

                    <LayoutListGroup v-if="sortedWalls.length">
                        <li
                            v-for="(wall, index) in sortedWalls"
                            :key="wall.key"
                            class="panel-row"
                            :class="{
                                'panel-row--active':
                                    wall.key === editor.selectedWall.value?.key,
                            }"
                            data-testid="map-editor-wall-item"
                            :data-name="wall.name"
                        >
                            <button
                                type="button"
                                class="panel-row__main"
                                :aria-pressed="
                                    wall.key === editor.selectedWall.value?.key
                                "
                                @click="selectWall(wall.key)"
                            >
                                {{ wall.name || $t('mapEditor.missing.name') }}
                            </button>
                            <UBadge
                                v-bind="wallStatus(wall)"
                                size="sm"
                                variant="subtle"
                                class="shrink-0"
                            />
                            <UDropdownMenu :items="wallMenu(wall, index)">
                                <UButton
                                    icon="i-lucide-ellipsis-vertical"
                                    color="neutral"
                                    variant="ghost"
                                    square
                                    :aria-label="$t('mapEditor.wallActions')"
                                />
                            </UDropdownMenu>
                        </li>
                    </LayoutListGroup>

                    <div
                        v-if="editor.selectedWall.value"
                        class="panel-details"
                        data-testid="map-editor-wall-details"
                    >
                        <UFormField :label="$t('mapEditor.wallName')">
                            <UInput
                                :model-value="editor.selectedWall.value.name"
                                :maxlength="100"
                                class="w-full"
                                data-testid="map-editor-wall-name"
                                @change="renameWall"
                            />
                        </UFormField>
                        <div class="flex gap-2">
                            <UFormField
                                :label="$t('mapEditor.anchorFrom')"
                                class="flex-1"
                            >
                                <UInputNumber
                                    :model-value="
                                        editor.selectedWall.value.anchorFrom
                                    "
                                    :min="1"
                                    class="w-full"
                                    data-testid="map-editor-wall-anchor-from"
                                    @update:model-value="
                                        setAnchor('anchorFrom', $event)
                                    "
                                />
                            </UFormField>
                            <UFormField
                                :label="$t('mapEditor.anchorTo')"
                                class="flex-1"
                            >
                                <UInputNumber
                                    :model-value="
                                        editor.selectedWall.value.anchorTo
                                    "
                                    :min="1"
                                    class="w-full"
                                    data-testid="map-editor-wall-anchor-to"
                                    @update:model-value="
                                        setAnchor('anchorTo', $event)
                                    "
                                />
                            </UFormField>
                        </div>
                        <UStepper
                            :items="steps"
                            :model-value="currentStep"
                            orientation="vertical"
                            size="sm"
                            :linear="false"
                            @update:model-value="startStep"
                        >
                            <template #description="{ item }">
                                <UButton
                                    color="primary"
                                    variant="link"
                                    size="sm"
                                    class="px-0"
                                    :data-testid="item.testId"
                                    @click.stop="startStep(item.value)"
                                >
                                    {{ item.action }}
                                </UButton>
                            </template>
                        </UStepper>
                        <div class="flex flex-wrap items-center gap-2">
                            <UButton
                                size="sm"
                                variant="ghost"
                                color="error"
                                icon="i-lucide-trash-2"
                                :disabled="selectedWallRoutes > 0"
                                data-testid="map-editor-delete-wall"
                                @click="deleteWall(editor.selectedWall.value)"
                            >
                                {{ $t('mapEditor.deleteWall') }}
                            </UButton>
                            <span
                                v-if="selectedWallRoutes > 0"
                                class="text-xs text-muted"
                                data-testid="map-editor-wall-has-routes"
                            >
                                {{
                                    $t(
                                        'mapEditor.routesOnWall',
                                        selectedWallRoutes,
                                    )
                                }}
                            </span>
                        </div>
                    </div>
                </div>
            </template>

            <template #floor>
                <div class="panel-tab">
                    <LayoutListGroup v-if="state.map.shapes.length">
                        <li
                            v-for="(shape, index) in state.map.shapes"
                            :key="index"
                            class="panel-row"
                            :class="{
                                'panel-row--active':
                                    selectedShapeIndex === index,
                            }"
                        >
                            <button
                                type="button"
                                class="panel-row__main panel-row__main--icon"
                                :aria-pressed="selectedShapeIndex === index"
                                data-testid="map-editor-shape-item"
                                @click="selectShape(index)"
                            >
                                <UIcon
                                    :name="SHAPE_ICONS[shape.kind]"
                                    class="size-5 shrink-0"
                                />
                                {{
                                    `${$t(`mapEditor.kinds.${shape.kind}`)} ${index + 1}`
                                }}
                            </button>
                        </li>
                    </LayoutListGroup>
                    <div
                        v-if="selectedShapeIndex !== null"
                        class="panel-details"
                    >
                        <UFormField :label="$t('mapEditor.shapeKind')">
                            <USelect
                                :model-value="
                                    state.map.shapes[selectedShapeIndex]?.kind
                                "
                                :items="kindItems"
                                class="w-full"
                                @update:model-value="changeKind"
                            />
                        </UFormField>
                        <UFormField
                            v-if="
                                state.map.shapes[selectedShapeIndex]?.kind ===
                                'structure'
                            "
                            :label="$t('mapEditor.level')"
                        >
                            <SegmentedControl
                                :model-value="
                                    String(
                                        state.map.shapes[selectedShapeIndex]
                                            ?.level ?? 1,
                                    )
                                "
                                :items="levelItems"
                                test-id="map-editor-shape-level"
                                @update:model-value="changeLevel"
                            />
                        </UFormField>
                        <UButton
                            size="sm"
                            variant="ghost"
                            color="error"
                            icon="i-lucide-trash-2"
                            class="self-start"
                            data-testid="map-editor-delete-shape"
                            @click="deleteShape"
                        >
                            {{ $t('mapEditor.deleteShape') }}
                        </UButton>
                    </div>
                </div>
            </template>

            <template #hall>
                <div class="panel-tab">
                    <form class="panel-form" @submit.prevent="resize">
                        <UFormField
                            :label="$t('mapEditor.width')"
                            class="flex-1"
                        >
                            <UInput
                                v-model.number="width"
                                type="number"
                                class="w-full"
                                data-testid="map-editor-width"
                            >
                                <template #trailing>
                                    <span class="text-xs text-muted">m</span>
                                </template>
                            </UInput>
                        </UFormField>
                        <UFormField
                            :label="$t('mapEditor.height')"
                            class="flex-1"
                        >
                            <UInput
                                v-model.number="height"
                                type="number"
                                class="w-full"
                                data-testid="map-editor-height"
                            >
                                <template #trailing>
                                    <span class="text-xs text-muted">m</span>
                                </template>
                            </UInput>
                        </UFormField>
                        <UButton
                            type="submit"
                            color="neutral"
                            variant="outline"
                            class="self-end"
                            :disabled="
                                width === state.map.width &&
                                height === state.map.height
                            "
                        >
                            {{ $t('mapEditor.apply') }}
                        </UButton>
                    </form>
                    <p v-if="resizeError" class="text-xs text-error">
                        {{ $t('mapEditor.resizeTooSmall') }}
                    </p>

                    <LayoutEyebrow>{{ $t('mapEditor.trace') }}</LayoutEyebrow>
                    <UFileUpload
                        v-model="traceFile"
                        :accept="TRACE_TYPES.join(',')"
                        :label="
                            hasTrace
                                ? $t('mapEditor.replaceTrace')
                                : $t('mapEditor.uploadTrace')
                        "
                        icon="i-lucide-image-plus"
                        :variant="hasTrace ? 'button' : 'area'"
                        :preview="false"
                        class="w-full"
                        data-testid="map-editor-trace-upload"
                    />
                    <template v-if="hasTrace && state.map.trace">
                        <UButton
                            size="sm"
                            variant="ghost"
                            color="error"
                            icon="i-lucide-trash-2"
                            class="self-start"
                            data-testid="map-editor-trace-remove"
                            @click="emit('removeTrace')"
                        >
                            {{ $t('mapEditor.removeTrace') }}
                        </UButton>
                        <UFormField :label="$t('mapEditor.traceOpacity')">
                            <USlider
                                :model-value="state.map.trace.opacity"
                                :min="0.1"
                                :max="1"
                                :step="0.05"
                                @update:model-value="previewOpacity"
                                @change="editor.endGesture()"
                            />
                        </UFormField>
                        <div class="panel-form">
                            <UFormField
                                v-for="traceField in traceFields"
                                :key="traceField.key"
                                :label="traceField.label"
                                class="flex-1"
                            >
                                <UInputNumber
                                    :model-value="
                                        state.map.trace[traceField.key]
                                    "
                                    :step="0.1"
                                    :min="
                                        traceField.key === 'width'
                                            ? 0.1
                                            : undefined
                                    "
                                    :increment="false"
                                    :decrement="false"
                                    class="w-full"
                                    @update:model-value="
                                        setTraceNumber(traceField.key, $event)
                                    "
                                />
                            </UFormField>
                        </div>
                        <UButton
                            color="neutral"
                            variant="outline"
                            icon="i-lucide-maximize"
                            data-testid="map-editor-trace-fit"
                            @click="
                                setTrace({
                                    x: 0,
                                    y: 0,
                                    width: state.map.width,
                                })
                            "
                        >
                            {{ $t('mapEditor.traceFit') }}
                        </UButton>
                    </template>
                </div>
            </template>
        </LayoutTabs>
    </div>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import {
    MAP_SHAPE_KINDS,
    type MapShapeKind,
    type MapTrace,
} from '#shared/utils/mapGeometry'
import {
    canResize,
    moveWall,
    nextWallName,
    removeShape,
    removeWall,
    setShapeKind,
    setShapeLevel,
    SHAPE_ICONS,
    updateWall,
    wallProblems,
    type EditorState,
    type EditorWall,
    type FloorPlanError,
    TRACE_TYPES,
} from '~/utils/mapEditor'

type PanelTab = 'walls' | 'floor' | 'hall'

const props = defineProps<{
    editor: ReturnType<typeof useMapEditor>
    hasTrace: boolean
    routeCounts: Map<string, number>
    saveErrors: FloorPlanError[]
}>()

const emit = defineEmits<{
    uploadTrace: [file: File]
    removeTrace: []
}>()

const saveErrorText = useFloorPlanErrorText()
const { success } = useNotification()

const { t } = useI18n()
const editor = props.editor
const state = computed(() => editor.state.value)
const traceFile = ref<File | null>(null)

watch(traceFile, (file) => {
    if (!file) return
    emit('uploadTrace', file)
    traceFile.value = null
})

const tab = ref<PanelTab>('walls')
const width = ref(state.value.map.width)
const height = ref(state.value.map.height)
const resizeError = ref(false)

watch(
    () => [state.value.map.width, state.value.map.height],
    ([nextWidth, nextHeight]) => {
        width.value = nextWidth!
        height.value = nextHeight!
    },
)

watch(
    () => editor.selection.value?.kind,
    (kind) => {
        if (kind === 'wall') tab.value = 'walls'
        else if (kind === 'shape') tab.value = 'floor'
    },
)

watch(editor.tool, (tool) => {
    if (tool === 'trace') tab.value = 'hall'
})

const sortedWalls = computed(() =>
    [...state.value.walls].sort((a, b) => a.sort - b.sort),
)
const selectedShapeIndex = computed(() =>
    editor.selection.value?.kind === 'shape'
        ? editor.selection.value.index
        : null,
)
const tabs = computed(() => [
    {
        value: 'walls' as const,
        slot: 'walls' as const,
        label: t('mapEditor.walls'),
        badge: state.value.walls.length || undefined,
    },
    {
        value: 'floor' as const,
        slot: 'floor' as const,
        label: t('mapEditor.floor'),
        badge: state.value.map.shapes.length || undefined,
    },
    {
        value: 'hall' as const,
        slot: 'hall' as const,
        label: t('mapEditor.hall'),
    },
])
const kindItems = computed(() =>
    MAP_SHAPE_KINDS.map((kind) => ({
        label: t(`mapEditor.kinds.${kind}`),
        value: kind,
    })),
)

const traceFields = computed(() => [
    { key: 'x' as const, label: 'X' },
    { key: 'y' as const, label: 'Y' },
    { key: 'width' as const, label: t('mapEditor.width') },
])

function commit(next: EditorState) {
    editor.commit(next)
}

function undoable(message: string) {
    const after = editor.state.value
    success(message, {
        label: t('mapEditor.undo'),
        onClick: () => {
            if (editor.state.value === after) editor.undo()
        },
    })
}

function wallStatus(wall: EditorWall) {
    const failed = props.saveErrors.find((error) => error.key === wall.key)
    if (failed)
        return {
            color: 'error' as const,
            icon: 'i-lucide-circle-x',
            label: saveErrorText(failed),
        }
    const [problem] = wallProblems(wall, state.value.walls)
    if (problem)
        return {
            color: 'warning' as const,
            icon: 'i-lucide-triangle-alert',
            label: t(`mapEditor.missing.${problem}`),
        }
    return {
        color: 'success' as const,
        icon: 'i-lucide-check',
        label: t('mapEditor.complete'),
    }
}

function wallMenu(wall: EditorWall, index: number): DropdownMenuItem[][] {
    return [
        [
            {
                label: t('mapEditor.moveUp'),
                icon: 'i-lucide-arrow-up',
                disabled: index === 0,
                onSelect: () => commit(moveWall(state.value, wall.key, -1)),
            },
            {
                label: t('mapEditor.moveDown'),
                icon: 'i-lucide-arrow-down',
                disabled: index === sortedWalls.value.length - 1,
                onSelect: () => commit(moveWall(state.value, wall.key, 1)),
            },
        ],
        [
            {
                label: t('mapEditor.deleteWall'),
                icon: 'i-lucide-trash-2',
                color: 'error',
                disabled: routesOn(wall) > 0,
                onSelect: () => deleteWall(wall),
            },
        ],
    ]
}

function selectWall(key: string) {
    editor.selectTool('select')
    editor.selection.value = { kind: 'wall', key }
    editor.selectedVertex.value = null
}

function selectShape(index: number) {
    editor.selectTool('select')
    editor.selection.value = { kind: 'shape', index }
    editor.selectedVertex.value = null
}

function newWall() {
    editor.addNewWall(
        nextWallName(state.value.walls, (n) =>
            t('mapEditor.defaultWallName', { n }),
        ),
    )
}

const steps = computed(() => {
    const wall = editor.selectedWall.value
    const has = {
        outline: !!wall && wall.outline.length >= 3,
        edge: !!wall && wall.edge.length >= 2,
    }
    return [
        {
            value: 0,
            title: t('mapEditor.steps.outline'),
            action: t(has.outline ? 'mapEditor.redraw' : 'mapEditor.draw'),
            testId: 'map-editor-draw-outline',
        },
        {
            value: 1,
            title: t('mapEditor.steps.edge'),
            action: t(has.edge ? 'mapEditor.redraw' : 'mapEditor.draw'),
            testId: 'map-editor-draw-edge',
        },
        {
            value: 2,
            title: t('mapEditor.steps.label'),
            action: t('mapEditor.moveLabel'),
            testId: 'map-editor-place-label',
        },
    ]
})

const currentStep = computed(() => {
    const wall = editor.selectedWall.value
    if (!wall) return 0
    const problems = wallProblems(wall)
    if (problems.includes('outline')) return 0
    if (problems.includes('edge')) return 1
    return 3
})

const STEP_TOOLS = ['outline', 'edge', 'label'] as const

function startStep(step: string | number | undefined) {
    const tool = STEP_TOOLS[Number(step)]
    if (tool) editor.selectTool(tool)
}

function renameWall(event: Event) {
    const wall = editor.selectedWall.value
    const name = (event.target as HTMLInputElement).value.trim()
    if (!wall || !name || name === wall.name) return
    commit(updateWall(state.value, wall.key, { name }))
}

function setAnchor(
    field: 'anchorFrom' | 'anchorTo',
    raw: number | null | undefined,
) {
    const wall = editor.selectedWall.value
    if (!wall) return
    const value = typeof raw === 'number' && raw > 0 ? Math.round(raw) : null
    if (value === wall[field]) return
    commit(updateWall(state.value, wall.key, { [field]: value }))
}

function routesOn(wall: EditorWall) {
    return wall.id ? (props.routeCounts.get(wall.id) ?? 0) : 0
}

const selectedWallRoutes = computed(() =>
    editor.selectedWall.value ? routesOn(editor.selectedWall.value) : 0,
)

function deleteWall(wall: EditorWall) {
    if (routesOn(wall) > 0) return
    commit(removeWall(state.value, wall.key))
    if (editor.selection.value?.kind === 'wall') editor.selection.value = null
    undoable(t('mapEditor.deleted', { name: wall.name }))
}

function changeKind(kind: MapShapeKind | null) {
    if (selectedShapeIndex.value === null || !kind) return
    commit(setShapeKind(state.value, selectedShapeIndex.value, kind))
}

const levelItems = computed(() =>
    (['1', '2', '3'] as const).map((value) => ({
        value,
        label: t(`mapEditor.levels.${value}`),
    })),
)

function changeLevel(level: string) {
    if (selectedShapeIndex.value === null) return
    commit(setShapeLevel(state.value, selectedShapeIndex.value, Number(level)))
}

function deleteShape() {
    const index = selectedShapeIndex.value
    if (index === null) return
    const shape = state.value.map.shapes[index]!
    commit(removeShape(state.value, index))
    editor.selection.value = null
    undoable(
        t('mapEditor.deleted', {
            name: `${t(`mapEditor.kinds.${shape.kind}`)} ${index + 1}`,
        }),
    )
}

function resize() {
    const nextWidth = Number(width.value)
    const nextHeight = Number(height.value)
    resizeError.value = !canResize(state.value, nextWidth, nextHeight)
    if (resizeError.value) return
    commit({
        ...state.value,
        map: { ...state.value.map, width: nextWidth, height: nextHeight },
    })
}

function setTrace(patch: Partial<MapTrace>) {
    const trace = state.value.map.trace
    if (!trace) return
    commit({
        ...state.value,
        map: { ...state.value.map, trace: { ...trace, ...patch } },
    })
}

function previewOpacity(opacity: number | undefined) {
    const trace = state.value.map.trace
    if (!trace || opacity === undefined) return
    if (!editor.inGesture()) editor.beginGesture()
    editor.preview({
        ...state.value,
        map: { ...state.value.map, trace: { ...trace, opacity } },
    })
}

function setTraceNumber(
    key: 'x' | 'y' | 'width',
    value: number | null | undefined,
) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    if (key === 'width' && value <= 0) return
    if (state.value.map.trace?.[key] === value) return
    setTrace({ [key]: value })
}
</script>

<style scoped>
.editor-panel {
    display: flex;
    flex-direction: column;
    padding: 4px 16px 16px;
    overflow-y: auto;
}

.panel-tab {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 12px;
}

.panel-form {
    display: flex;
    align-items: center;
    gap: 8px;
}

.panel-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 48px;
    padding-right: 4px;
}

.panel-row__main {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0 12px;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
    color: var(--ui-text-highlighted);
}

.panel-row__main--icon {
    display: flex;
    align-items: center;
    gap: 12px;
}

.panel-row--active {
    background: color-mix(in oklab, var(--ui-primary) 10%, transparent);
    box-shadow: inset 3px 0 var(--ui-primary);
}

.panel-details {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border-radius: calc(var(--ui-radius) * 2);
    background: var(--ui-bg-elevated);
}
</style>
