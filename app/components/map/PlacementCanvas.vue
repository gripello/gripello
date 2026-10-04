<template>
    <MapCanvas
        :pan-zoom="panZoom"
        :label="$t('mapPlacement.canvasLabel')"
        role="application"
        :cursor="armedRouteId ? 'crosshair' : undefined"
        data-testid="placement-canvas"
        @click="onCanvasClick"
    >
        <MapFloorLayer :shapes="map.shapes" />

        <g
            v-for="wall in walls"
            :key="wall.id"
            class="placement-wall"
            :class="{
                'placement-wall--selected': wall.id === selectedWallId,
            }"
            data-testid="placement-wall"
            :data-name="wall.name"
            role="button"
            tabindex="0"
            :aria-pressed="wall.id === selectedWallId"
            :aria-label="wall.name"
            @click.stop="onWallClick(wall.id, $event)"
            @keydown.enter.prevent="onWallKey(wall.id)"
            @keydown.space.prevent="onWallKey(wall.id)"
        >
            <path
                :d="svgPath(wall.outline)"
                class="placement-wall-outline"
                data-testid="placement-wall-outline"
            />
            <path :d="svgPath(wall.edge, false)" class="placement-wall-edge" />
            <text
                :x="wall.labelAt[0]"
                :y="wall.labelAt[1]"
                :font-size="13 / pixelsPerUnit"
                class="placement-wall-label"
                text-anchor="middle"
                dominant-baseline="middle"
            >
                {{ wall.name }}
            </text>
        </g>

        <MapRouteMarker
            v-for="dot in dots"
            :key="dot.routeId"
            :at="dot.point"
            :fill="dot.fill"
            :stroke="dot.stroke"
            :grade="dot.grade"
            :as-grade="isolated.has(dot.routeId)"
            :is-new="dot.isNew"
            :selected="dot.routeId === selectedRouteId"
            :pixels-per-unit="pixelsPerUnit"
            :hit-radius-px="hitRadiusPx"
            class="placement-dot"
            :class="{
                'placement-dot--dragging': dot.routeId === draggingRouteId,
            }"
            data-draggable
            data-testid="placement-dot"
            :data-route-id="dot.routeId"
            role="button"
            tabindex="0"
            :aria-pressed="dot.routeId === selectedRouteId"
            :aria-label="dotLabel(dot.routeId)"
            @pointerdown.stop="onDotDown(dot.routeId, $event)"
            @click.stop
            @keydown.enter.prevent="onDotKey(dot)"
            @keydown.space.prevent="onDotKey(dot)"
        />

        <circle
            v-if="ghost"
            :cx="ghost.point[0]"
            :cy="ghost.point[1]"
            :r="(DOT_RADIUS_PX * 1.3) / pixelsPerUnit"
            class="placement-ghost"
            pointer-events="none"
            data-testid="placement-ghost"
        />
    </MapCanvas>
</template>

<script setup lang="ts">
import {
    boundsOf,
    nearestWall,
    pointInPolygon,
    projectOntoPolyline,
    type EdgeProjection,
    type GymMap,
    type MapBounds,
} from '#shared/utils/mapGeometry'
import { translatedColorName } from '~/utils/colorName'
import {
    DOT_RADIUS_PX,
    gradeSpacingPx,
    HIT_RADIUS_PX,
    isolatedIds,
    placeRoutes,
    type MapRoute,
    type MapWall,
    type RouteDot,
} from '~/utils/gymMap'
import { svgPath } from '~/utils/mapSvg'

const props = defineProps<{
    map: GymMap
    walls: MapWall[]
    routes: MapRoute[]
    selectedRouteId: string | null
    selectedWallId: string | null
    armedRouteId: string | null
    insetBottom?: number
}>()

const emit = defineEmits<{
    place: [routeId: string, wallId: string, position: number]
    selectRoute: [routeId: string | null]
    selectWall: [wallId: string | null]
}>()

const { t } = useI18n()
const SNAP_RADIUS_PX = 60
const DRAG_THRESHOLD_PX = 4

const bounds = computed<MapBounds>(() => ({
    minX: 0,
    minY: 0,
    maxX: props.map.width,
    maxY: props.map.height,
}))
const panZoom = useSvgPanZoom({
    bounds,
    minWidth: 2,
    doubleClickZoom: true,
    insetBottom: computed(() => props.insetBottom ?? 0),
    canStartPan: (event) =>
        !(event.target as Element).closest('[data-draggable]'),
})
const { pixelsPerUnit, toMap, fitAll, fitTo, svgRef } = panZoom

const coarsePointer = useCoarsePointer()
const hitRadiusPx = computed(() =>
    coarsePointer.value ? HIT_RADIUS_PX.coarse : HIT_RADIUS_PX.fine,
)
const draggingRouteId = ref<string | null>(null)
const ghost = ref<(EdgeProjection & { wall: MapWall }) | null>(null)

const dots = computed(() => placeRoutes(props.walls, props.routes))
const isolated = computed(() =>
    isolatedIds(
        dots.value,
        gradeSpacingPx(hitRadiusPx.value) / pixelsPerUnit.value,
    ),
)
const routesById = computed(
    () => new Map(props.routes.map((route) => [route.id, route])),
)

function dotLabel(routeId: string) {
    const route = routesById.value.get(routeId)
    return [route?.name, translatedColorName(t, route?.color)]
        .filter(Boolean)
        .join(', ')
}

function snapAt(client: { clientX: number; clientY: number }) {
    const point = toMap({ x: client.clientX, y: client.clientY })
    const containing = props.walls.find((wall) =>
        pointInPolygon(point, wall.outline),
    )
    const projection = containing && projectOntoPolyline(containing.edge, point)
    if (containing && projection) return { ...projection, wall: containing }
    return nearestWall(props.walls, point, SNAP_RADIUS_PX / pixelsPerUnit.value)
}

function isOverCanvas(clientX: number, clientY: number) {
    const bounds = svgRef.value?.getBoundingClientRect()
    return (
        !!bounds &&
        clientX >= bounds.left &&
        clientX <= bounds.right &&
        clientY >= bounds.top &&
        clientY <= bounds.bottom
    )
}

function previewAt(clientX: number, clientY: number) {
    ghost.value = isOverCanvas(clientX, clientY)
        ? snapAt({ clientX, clientY })
        : null
}

function placeAt(routeId: string, clientX: number, clientY: number) {
    ghost.value = null
    if (!isOverCanvas(clientX, clientY)) return false
    return place(routeId, { clientX, clientY })
}

defineExpose({ fitAll, focusWall, previewAt, placeAt })

function focusWall(wallId: string) {
    const wall = props.walls.find((candidate) => candidate.id === wallId)
    const wallBounds = wall && boundsOf([...wall.outline, ...wall.edge])
    if (wallBounds) fitTo(wallBounds, { padding: 2 })
}

function place(routeId: string, client: { clientX: number; clientY: number }) {
    const target = snapAt(client)
    if (target) emit('place', routeId, target.wall.id, target.position)
    return !!target
}

function onCanvasClick(event: MouseEvent) {
    if (props.armedRouteId) {
        place(props.armedRouteId, event)
        return
    }
    emit('selectRoute', null)
    emit('selectWall', null)
}

function onWallClick(wallId: string, event: MouseEvent) {
    if (props.armedRouteId) {
        place(props.armedRouteId, event)
        return
    }
    emit('selectWall', wallId)
}

function onWallKey(wallId: string) {
    if (props.armedRouteId) emit('place', props.armedRouteId, wallId, 0.5)
    else emit('selectWall', wallId)
}

function onDotKey(dot: RouteDot) {
    const route = routesById.value.get(dot.routeId)
    if (props.armedRouteId && props.armedRouteId !== dot.routeId)
        emit(
            'place',
            props.armedRouteId,
            dot.wallId,
            route?.wall_position ?? 0.5,
        )
    else emit('selectRoute', dot.routeId)
}

function onDotDown(routeId: string, event: PointerEvent) {
    if (event.button !== 0) return
    const target = event.currentTarget as SVGElement
    target.setPointerCapture(event.pointerId)
    const start = { x: event.clientX, y: event.clientY }
    let moved = false

    const move = (moveEvent: PointerEvent) => {
        if (
            !moved &&
            Math.hypot(
                moveEvent.clientX - start.x,
                moveEvent.clientY - start.y,
            ) < DRAG_THRESHOLD_PX
        )
            return
        moved = true
        draggingRouteId.value = routeId
        ghost.value = snapAt(moveEvent)
    }
    const end = (endEvent: PointerEvent) => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', end)
        target.removeEventListener('pointercancel', cancel)
        if (moved) place(routeId, endEvent)
        else if (props.armedRouteId && props.armedRouteId !== routeId)
            place(props.armedRouteId, endEvent)
        else emit('selectRoute', routeId)
        draggingRouteId.value = null
        ghost.value = null
    }
    const cancel = () => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', end)
        target.removeEventListener('pointercancel', cancel)
        draggingRouteId.value = null
        ghost.value = null
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', cancel)
}
</script>

<style scoped>
.placement-wall {
    cursor: pointer;
}

.placement-wall-outline {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 20%, transparent);
    stroke: color-mix(in oklab, var(--ui-text-highlighted) 30%, transparent);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
}

.placement-wall:focus {
    outline: none;
}

.placement-wall:focus-visible .placement-wall-outline {
    stroke: var(--ui-primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
}

.placement-wall--selected .placement-wall-outline {
    fill: color-mix(in oklab, var(--ui-primary) 20%, transparent);
    stroke: var(--ui-primary);
    stroke-width: 2;
}

.placement-wall-edge {
    fill: none;
    stroke: color-mix(in oklab, var(--ui-primary) 55%, transparent);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-dasharray: 2 5;
    vector-effect: non-scaling-stroke;
}

.placement-wall-label {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 75%, transparent);
    font-weight: 600;
    pointer-events: none;
}

.map-dot.placement-dot {
    cursor: grab;
}

.placement-dot--dragging {
    opacity: 0.4;
}

.placement-ghost {
    fill: color-mix(in oklab, var(--ui-primary) 35%, transparent);
    stroke: var(--ui-primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
}
</style>
