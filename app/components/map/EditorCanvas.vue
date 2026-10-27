<template>
    <MapCanvas
        :pan-zoom="panZoom"
        :label="$t('mapEditor.canvasLabel')"
        role="application"
        :cursor="
            isDrawing || editor.tool.value === 'label' ? 'crosshair' : undefined
        "
        data-testid="map-editor-canvas"
        @click="onCanvasClick"
        @dblclick.prevent="editor.finishDraft()"
        @pointerdown="onCanvasPointerDown"
        @pointermove="onHover"
        @pointerup="onCanvasPointerUp"
        @pointerleave="hoverPoint = null"
    >
        <defs>
            <pattern
                :id="gridId"
                :width="grid"
                :height="grid"
                patternUnits="userSpaceOnUse"
            >
                <path
                    :d="`M ${grid} 0 L 0 0 0 ${grid}`"
                    class="editor-grid-line"
                />
            </pattern>
        </defs>

        <rect
            class="editor-background"
            data-background
            :width="map.width"
            :height="map.height"
        />
        <image
            v-if="traceUrl && map.trace"
            :href="traceUrl"
            :x="map.trace.x"
            :y="map.trace.y"
            :width="map.trace.width"
            :height="traceHeight"
            :opacity="map.trace.opacity"
            preserveAspectRatio="none"
            pointer-events="none"
            data-testid="map-editor-trace"
            @error="emit('trace-error')"
        />
        <rect
            v-if="grid > 0"
            data-background
            :width="map.width"
            :height="map.height"
            :fill="`url(#${gridId})`"
        />

        <MapFloorLayer
            :shapes="map.shapes"
            :selected-index="selectedShapeIndex"
            :pixels-per-unit="pixelsPerUnit"
            selectable
            @shape-click="onShapeClick"
        />

        <g
            v-for="wall in walls"
            :key="wall.key"
            class="editor-wall"
            :class="{ 'editor-wall--selected': wall.key === selectedWallKey }"
            data-testid="map-editor-wall"
            :data-name="wall.name"
            :role="isSelectTool ? 'button' : undefined"
            :tabindex="isSelectTool ? 0 : -1"
            :aria-pressed="
                isSelectTool ? wall.key === selectedWallKey : undefined
            "
            :aria-label="wall.name || $t('mapEditor.missing.name')"
            @click="onWallClick(wall, $event)"
            @keydown.enter.prevent="onWallClick(wall, $event)"
            @keydown.space.prevent="onWallClick(wall, $event)"
        >
            <path
                v-if="wall.outline.length >= 3"
                :d="svgPath(wall.outline)"
                class="editor-wall-outline"
            />
            <path
                v-if="wall.edge.length >= 2"
                :d="svgPath(wall.edge, false)"
                class="editor-wall-edge"
            />
            <text
                v-if="wall.outline.length >= 3"
                :x="labelFor(wall)[0]"
                :y="labelFor(wall)[1]"
                :font-size="14 / pixelsPerUnit"
                class="editor-wall-label"
                :class="{
                    'editor-wall-label--movable': wall.key === selectedWallKey,
                }"
                :data-draggable="wall.key === selectedWallKey ? '' : undefined"
                data-testid="map-editor-wall-label"
                text-anchor="middle"
                dominant-baseline="middle"
                @pointerdown="onLabelDown(wall, $event)"
            >
                {{ wall.name }}
            </text>
        </g>

        <g v-if="isTraceTool && traceUrl && map.trace">
            <rect
                class="editor-trace-frame"
                data-draggable
                data-testid="map-editor-trace-frame"
                :x="map.trace.x"
                :y="map.trace.y"
                :width="map.trace.width"
                :height="traceHeight"
                @pointerdown.stop="onTraceDown"
                @click.stop
            />
            <g
                class="editor-handle editor-vertex"
                data-draggable
                data-testid="map-editor-trace-scale"
                role="button"
                :aria-label="$t('mapEditor.traceScale')"
                @pointerdown.stop="onTraceScaleDown"
                @click.stop
            >
                <circle
                    class="editor-hit"
                    :cx="map.trace.x + map.trace.width"
                    :cy="map.trace.y + traceHeight"
                    :r="hitRadius"
                />
                <circle
                    class="editor-handle__mark"
                    :cx="map.trace.x + map.trace.width"
                    :cy="map.trace.y + traceHeight"
                    :r="handleSize / 1.6"
                />
            </g>
        </g>

        <g v-for="handleSet in handleSets" :key="handleSet.id">
            <g
                v-for="midpoint in handleSet.midpoints"
                :key="`mid-${midpoint.afterIndex}`"
                class="editor-handle editor-midpoint"
                data-draggable
                data-testid="map-editor-midpoint"
                role="button"
                tabindex="0"
                :aria-label="$t('mapEditor.addPointLabel')"
                @pointerdown.stop="
                    onMidpointDown(handleSet.path, midpoint, $event)
                "
                @click.stop
                @keydown.enter.stop.prevent="
                    insertMidpoint(handleSet.path, midpoint)
                "
                @keydown.space.stop.prevent="
                    insertMidpoint(handleSet.path, midpoint)
                "
            >
                <circle
                    class="editor-hit"
                    :cx="midpoint.point[0]"
                    :cy="midpoint.point[1]"
                    :r="hitRadius"
                />
                <rect
                    class="editor-handle__mark"
                    :x="midpoint.point[0] - handleSize / 2"
                    :y="midpoint.point[1] - handleSize / 2"
                    :width="handleSize"
                    :height="handleSize"
                />
            </g>
            <g
                v-for="(point, index) in handleSet.points"
                :key="`vertex-${index}`"
                class="editor-handle editor-vertex"
                :class="{
                    'editor-vertex--selected': isSelectedVertex(
                        handleSet.path,
                        index,
                    ),
                    'editor-vertex--edge': handleSet.path.type === 'edge',
                }"
                data-draggable
                data-testid="map-editor-vertex"
                :data-path="handleSet.path.type"
                role="button"
                tabindex="0"
                :aria-pressed="isSelectedVertex(handleSet.path, index)"
                :aria-label="$t('mapEditor.pointLabel', { n: index + 1 })"
                @pointerdown.stop="onVertexDown(handleSet.path, index, $event)"
                @click.stop
                @keydown.enter.stop.prevent="
                    selectVertex(handleSet.path, index)
                "
                @keydown.space.stop.prevent="
                    selectVertex(handleSet.path, index)
                "
            >
                <circle
                    class="editor-hit"
                    :cx="point[0]"
                    :cy="point[1]"
                    :r="hitRadius"
                />
                <circle
                    class="editor-handle__mark"
                    :cx="point[0]"
                    :cy="point[1]"
                    :r="handleSize / 1.6"
                />
            </g>
        </g>

        <g
            v-if="moveHandle"
            class="editor-handle editor-move"
            data-draggable
            data-testid="map-editor-move"
            role="button"
            :aria-label="$t('mapEditor.move')"
            @pointerdown.stop="onMoveDown"
            @click.stop
        >
            <circle
                class="editor-hit"
                :cx="moveHandle[0]"
                :cy="moveHandle[1]"
                :r="hitRadius"
            />
            <circle
                class="editor-move__disc"
                :cx="moveHandle[0]"
                :cy="moveHandle[1]"
                :r="handleSize"
            />
            <path
                class="editor-move__arrows"
                :d="moveArrows(moveHandle, handleSize * 0.6)"
            />
        </g>

        <g v-if="isDrawing" class="editor-draft" pointer-events="none">
            <path
                v-if="draftPreview.length >= 2"
                :d="svgPath(draftPreview, false)"
                class="editor-draft-line"
            />
            <circle
                v-for="(point, index) in editor.draft.value"
                :key="index"
                :cx="point[0]"
                :cy="point[1]"
                :r="handleSize / (index === 0 ? 1.3 : 2)"
                class="editor-draft-point"
                :class="{ 'editor-draft-point--first': index === 0 }"
            />
        </g>

        <circle
            v-if="hoverPoint && (isDrawing || editor.tool.value === 'label')"
            :cx="hoverPoint[0]"
            :cy="hoverPoint[1]"
            :r="handleSize / 2.5"
            class="editor-cursor"
            pointer-events="none"
        />
    </MapCanvas>
</template>

<script setup lang="ts">
import {
    isOpenShape,
    labelPoint,
    pointInPolygon,
    type MapBounds,
    type MapPoint,
} from '#shared/utils/mapGeometry'
import {
    isOpenPath,
    midpoints,
    readPath,
    updateWall,
    type EditorPath,
    type EditorWall,
} from '~/utils/mapEditor'
import { svgPath } from '~/utils/mapSvg'

const props = defineProps<{
    editor: ReturnType<typeof useMapEditor>
    grid: number
    traceUrl?: string | null
    insetBottom?: number
}>()

const emit = defineEmits<{ 'trace-error': [] }>()

const HANDLE_PX = { fine: 12, coarse: 22 }
const HIT_PX = { fine: 12, coarse: 22 }
const SNAP_PX = { fine: 10, coarse: 18 }

const gridId = useId()
const editor = props.editor
const map = computed(() => editor.state.value.map)
const walls = computed(() =>
    [...editor.state.value.walls].sort((a, b) => a.sort - b.sort),
)
const bounds = computed<MapBounds>(() => ({
    minX: 0,
    minY: 0,
    maxX: map.value.width,
    maxY: map.value.height,
}))

const panZoom = useSvgPanZoom({
    bounds,
    minWidth: 1,
    insetBottom: computed(() => props.insetBottom ?? 0),
    canStartPan: (event) =>
        !(event.target as Element).closest('[data-draggable]'),
})
const { pixelsPerUnit, toMap, fitAll, zoomBy } = panZoom
const coarsePointer = useCoarsePointer()
const pointerKind = computed(() => (coarsePointer.value ? 'coarse' : 'fine'))
const snapPx = computed(() => SNAP_PX[pointerKind.value])

const hoverPoint = ref<MapPoint | null>(null)
const handleSize = computed(
    () => HANDLE_PX[pointerKind.value] / pixelsPerUnit.value,
)
const hitRadius = computed(
    () => HIT_PX[pointerKind.value] / pixelsPerUnit.value,
)
const isTraceTool = computed(() => editor.tool.value === 'trace')
const traceRatio = ref<number | null>(null)
const traceHeight = computed(() => {
    const trace = map.value.trace
    if (!trace) return 0
    return (
        trace.width * (traceRatio.value ?? map.value.height / map.value.width)
    )
})

watch(
    () => props.traceUrl,
    (url) => {
        traceRatio.value = null
        if (!url || typeof Image === 'undefined') return
        const image = new Image()
        image.onload = () => {
            if (props.traceUrl === url && image.naturalWidth)
                traceRatio.value = image.naturalHeight / image.naturalWidth
        }
        image.onerror = () => {
            if (props.traceUrl === url) emit('trace-error')
        }
        image.src = url
    },
    { immediate: true },
)

const isSelectTool = computed(() => editor.tool.value === 'select')
const isDrawing = editor.isDrawing
const selectedShapeIndex = computed(() =>
    editor.selection.value?.kind === 'shape'
        ? editor.selection.value.index
        : null,
)
const selectedWallKey = computed(() =>
    editor.selection.value?.kind === 'wall' ? editor.selection.value.key : null,
)

const draftPreview = computed(() =>
    hoverPoint.value
        ? [...editor.draft.value, hoverPoint.value]
        : editor.draft.value,
)

const handleSets = computed(() => {
    if (editor.tool.value !== 'select') return []
    const selection = editor.selection.value
    const paths: EditorPath[] =
        selection?.kind === 'shape'
            ? [{ type: 'shape', index: selection.index }]
            : selection?.kind === 'wall'
              ? [
                    { type: 'outline', key: selection.key },
                    { type: 'edge', key: selection.key },
                ]
              : []
    return paths.map((path) => {
        const points = readPath(editor.state.value, path)
        return {
            id: JSON.stringify(path),
            path,
            points,
            midpoints: midpoints(points, !isOpenPath(editor.state.value, path)),
        }
    })
})

function labelFor(wall: EditorWall): MapPoint {
    return wall.label ?? labelPoint(wall.outline)
}

function isSelectedVertex(path: EditorPath, index: number) {
    const selected = editor.selectedVertex.value
    return (
        !!selected &&
        selected.index === index &&
        JSON.stringify(selected.path) === JSON.stringify(path)
    )
}

const {
    snapped,
    selectVertex,
    insertMidpoint,
    onVertexDown,
    onMidpointDown,
    onTraceDown,
    onTraceScaleDown,
    onMoveDown,
    onLabelDown,
} = useMapEditorGestures({
    editor,
    panZoom,
    grid: () => props.grid,
    snapPx: () => snapPx.value,
})

let pressing = false

function showsCursor() {
    return isDrawing.value || editor.tool.value === 'label'
}

function onHover(event: PointerEvent) {
    if (!showsCursor()) return
    if (
        event.pointerType !== 'mouse' &&
        (!pressing || panZoom.isPanning.value)
    ) {
        hoverPoint.value = null
        return
    }
    hoverPoint.value = snapped(event)
}

function onCanvasPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' || !showsCursor()) return
    pressing = true
    hoverPoint.value = snapped(event)
}

function onCanvasPointerUp(event: PointerEvent) {
    if (event.pointerType === 'mouse') return
    pressing = false
    hoverPoint.value = null
}

function onShapeClick(index: number, event: Event) {
    if (editor.tool.value !== 'select') return
    event.stopPropagation()
    editor.selection.value = { kind: 'shape', index }
    editor.selectedVertex.value = null
}

const moveHandle = computed<MapPoint | null>(() => {
    if (editor.tool.value !== 'select') return null
    const selection = editor.selection.value
    if (selection?.kind === 'shape') {
        const points = editor.state.value.map.shapes[selection.index]?.points
        return points && points.length >= 3 ? labelPoint(points) : null
    }
    const wall = editor.selectedWall.value
    if (!wall || wall.outline.length < 3) return null
    const [x, y] = labelFor(wall)
    return [x, y + 28 / pixelsPerUnit.value]
})

function moveArrows([x, y]: MapPoint, size: number) {
    const head = size * 0.35
    return [
        `M ${x - size} ${y} L ${x + size} ${y}`,
        `M ${x} ${y - size} L ${x} ${y + size}`,
        `M ${x - size + head} ${y - head} L ${x - size} ${y} L ${x - size + head} ${y + head}`,
        `M ${x + size - head} ${y - head} L ${x + size} ${y} L ${x + size - head} ${y + head}`,
        `M ${x - head} ${y - size + head} L ${x} ${y - size} L ${x + head} ${y - size + head}`,
        `M ${x - head} ${y + size - head} L ${x} ${y + size} L ${x + head} ${y + size - head}`,
    ].join(' ')
}

function onWallClick(wall: EditorWall, event: Event) {
    if (editor.tool.value !== 'select') return
    event.stopPropagation()
    editor.selection.value = { kind: 'wall', key: wall.key }
    editor.selectedVertex.value = null
}

function closesPolygon(point: MapPoint) {
    const [first] = editor.draft.value
    if (!first || editor.draft.value.length < 3) return false
    const gap = Math.hypot(point[0] - first[0], point[1] - first[1])
    return (
        gap <=
        Math.max(snapPx.value, HIT_PX[pointerKind.value]) / pixelsPerUnit.value
    )
}

function onCanvasClick(event: MouseEvent) {
    const tool = editor.tool.value
    if (tool === 'trace') return
    if (tool === 'select') {
        if ((event.target as Element).hasAttribute('data-background')) {
            editor.selection.value = null
            editor.selectedVertex.value = null
        }
        return
    }
    const point = snapped(event)
    if (tool === 'label') {
        const wall = editor.selectedWall.value
        if (
            wall &&
            wall.outline.length >= 3 &&
            !pointInPolygon(point, wall.outline)
        )
            return
        if (wall)
            editor.commit(
                updateWall(editor.state.value, wall.key, { label: point }),
            )
        editor.selectTool('select')
        return
    }
    const open =
        tool === 'edge' ||
        (tool === 'shape' && isOpenShape(editor.shapeKind.value))
    if (!open && closesPolygon(point)) {
        editor.finishDraft()
        return
    }
    editor.draft.value = [...editor.draft.value, point]
}

defineExpose({ fitAll, zoomBy })
</script>

<style scoped>
.editor-background {
    fill: var(--ui-bg);
}

.editor-grid-line {
    fill: none;
    stroke: color-mix(in oklab, var(--ui-text-highlighted) 8%, transparent);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
}

.editor-wall-outline {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 30%, transparent);
    stroke: color-mix(in oklab, var(--ui-text-highlighted) 45%, transparent);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
}

.editor-wall--selected .editor-wall-outline {
    fill: color-mix(in oklab, var(--ui-primary) 28%, transparent);
    stroke: var(--ui-primary);
    stroke-width: 2;
}

.editor-wall:focus-visible .editor-wall-outline,
.editor-handle:focus-visible .editor-handle__mark {
    outline: none;
    stroke: var(--ui-secondary);
    stroke-width: 3;
    vector-effect: non-scaling-stroke;
}

.editor-wall-edge {
    fill: none;
    stroke: var(--ui-primary);
    stroke-width: 4;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
}

.editor-wall-label {
    fill: var(--ui-text-highlighted);
    font-weight: 600;
}

.editor-wall-label--movable {
    cursor: move;
    text-decoration: underline dotted;
}

.editor-trace-frame {
    fill: transparent;
    stroke: var(--ui-info);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
    vector-effect: non-scaling-stroke;
    cursor: move;
}

.editor-hit {
    fill: transparent;
}

.editor-handle {
    outline: none;
}

.editor-vertex {
    cursor: grab;
}

.editor-vertex .editor-handle__mark {
    fill: var(--ui-bg);
    stroke: var(--ui-primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
}

.editor-vertex--edge .editor-handle__mark {
    fill: var(--ui-primary);
}

.editor-vertex--selected .editor-handle__mark {
    fill: var(--ui-error);
    stroke: var(--ui-error);
}

.editor-midpoint {
    cursor: copy;
}

.editor-midpoint .editor-handle__mark {
    fill: color-mix(in oklab, var(--ui-primary) 50%, transparent);
}

.editor-move {
    cursor: move;
}

.editor-move__disc {
    fill: var(--ui-primary);
    stroke: var(--ui-bg);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
}

.editor-move__arrows {
    fill: none;
    stroke: var(--ui-bg);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
}

.editor-draft-line {
    fill: none;
    stroke: var(--ui-primary);
    stroke-width: 2;
    stroke-dasharray: 6 4;
    vector-effect: non-scaling-stroke;
}

.editor-draft-point {
    fill: var(--ui-primary);
}

.editor-draft-point--first {
    fill: var(--ui-bg);
    stroke: var(--ui-primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
}

.editor-cursor {
    fill: color-mix(in oklab, var(--ui-primary) 60%, transparent);
}
</style>
