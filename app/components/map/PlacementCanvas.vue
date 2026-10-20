<template>
    <MapCanvas
        :pan-zoom="panZoom"
        :label="$t('mapPlacement.canvasLabel')"
        role="application"
        :cursor="armedRouteId ? 'crosshair' : undefined"
        data-testid="placement-canvas"
        @click="onCanvasClick"
    >
        <MapFloorLayer :shapes="map.shapes" :pixels-per-unit="pixelsPerUnit" />

        <g
            v-for="wall in walls"
            :key="wall.id"
            class="placement-wall"
            :class="{
                'placement-wall--selected': wall.id === selectedWallId,
                'placement-wall--tinted': wallTints?.has(wall.id),
            }"
            :style="
                wallTints?.has(wall.id)
                    ? { '--wall-tint': wallTints.get(wall.id) }
                    : undefined
            "
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
            v-for="dot in shownDots"
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

        <g
            v-for="cluster in collapsedClusters"
            :key="cluster.key"
            class="placement-cluster"
            data-testid="placement-cluster"
            :data-count="cluster.dots.length"
            role="button"
            tabindex="0"
            :aria-label="
                $t(
                    'map.clusterLabel',
                    { count: cluster.dots.length },
                    cluster.dots.length,
                )
            "
            @click.stop="onClusterClick(cluster, $event)"
            @keydown.enter.prevent="openCluster(cluster)"
            @keydown.space.prevent="openCluster(cluster)"
        >
            <circle
                :cx="cluster.point[0]"
                :cy="cluster.point[1]"
                :r="hitRadiusPx / pixelsPerUnit"
                class="placement-cluster-hit"
            />
            <circle
                :cx="cluster.point[0]"
                :cy="cluster.point[1]"
                :r="CLUSTER_RADIUS_PX / pixelsPerUnit"
                class="placement-cluster-body"
            />
            <g
                :transform="`translate(${cluster.point[0]} ${cluster.point[1]}) scale(${1 / pixelsPerUnit})`"
            >
                <text
                    :font-size="CLUSTER_FONT_PX"
                    class="placement-cluster-count"
                >
                    {{ cluster.dots.length }}
                </text>
            </g>
        </g>

        <MapRouteMarker
            v-if="ghost && ghostRoute"
            :at="ghost.point"
            v-bind="dotColors(ghostRoute.color)"
            :grade="formatGrade(ghostRoute)"
            as-grade
            :pixels-per-unit="pixelsPerUnit"
            :hit-radius-px="0"
            class="placement-ghost"
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
import { formatGrade } from '#shared/utils/grades'
import {
    closestPairDistance,
    clusterDots,
    dotColors,
    GRADE_SPACING_PX,
    HIT_RADIUS_PX,
    isolatedIds,
    placeRoutes,
    type MapRoute,
    type DotCluster,
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
    wallTints?: ReadonlyMap<string, string> | null
}>()

const emit = defineEmits<{
    place: [routeId: string, wallId: string, position: number]
    selectRoute: [routeId: string | null]
    selectWall: [wallId: string | null]
}>()

const { t } = useI18n()
const SNAP_RADIUS_PX = 60
const DRAG_THRESHOLD_PX = 4
const CLUSTER_RADIUS_PX = 11
const CLUSTER_FONT_PX = 12

const bounds = computed<MapBounds>(() => ({
    minX: 0,
    minY: 0,
    maxX: props.map.width,
    maxY: props.map.height,
}))
const contentBounds = computed(() =>
    boundsOf([
        ...props.walls.flatMap((wall) => [...wall.outline, ...wall.edge]),
        ...props.map.shapes.flatMap((shape) => shape.points),
    ]),
)
const panZoom = useSvgPanZoom({
    bounds,
    homeBounds: contentBounds,
    minWidth: 2,
    doubleClickZoom: true,
    insetBottom: computed(() => props.insetBottom ?? 0),
    canStartPan: (event) =>
        !(event.target as Element).closest('[data-draggable]'),
})
const { pixelsPerUnit, toMap, fitAll, fitTo, svgRef, zoomBy, viewBox, limits } =
    panZoom

const coarsePointer = useCoarsePointer()
const hitRadiusPx = computed(() =>
    coarsePointer.value ? HIT_RADIUS_PX.coarse : HIT_RADIUS_PX.fine,
)
const draggingRouteId = ref<string | null>(null)
const ghost = ref<(EdgeProjection & { wall: MapWall; routeId: string }) | null>(
    null,
)
const ghostRoute = computed(
    () => ghost.value && routesById.value.get(ghost.value.routeId),
)

const dots = computed(() => placeRoutes(props.walls, props.routes))
const isolated = computed(() =>
    isolatedIds(dots.value, GRADE_SPACING_PX / pixelsPerUnit.value),
)
const expandedClusterKey = ref<string | null>(null)
const clusters = computed(() =>
    clusterDots(dots.value, hitRadiusPx.value / pixelsPerUnit.value),
)
const keepsOpen = (cluster: DotCluster<RouteDot>) =>
    cluster.key === expandedClusterKey.value ||
    cluster.dots.some(
        (dot) =>
            dot.routeId === props.selectedRouteId ||
            dot.routeId === draggingRouteId.value,
    )
const collapsedClusters = computed(() =>
    clusters.value.filter(
        (cluster) => cluster.dots.length > 1 && !keepsOpen(cluster),
    ),
)
const shownDots = computed(() => {
    const hidden = new Set(
        collapsedClusters.value.flatMap((cluster) =>
            cluster.dots.map((dot) => dot.routeId),
        ),
    )
    return dots.value.filter((dot) => !hidden.has(dot.routeId))
})

function openCluster(cluster: DotCluster<RouteDot>) {
    const needed =
        (hitRadiusPx.value * 2.2) /
        pixelsPerUnit.value /
        closestPairDistance(cluster.dots.map((dot) => dot.point))
    const available = viewBox.value.width / limits.value.minWidth
    zoomBy(Math.min(needed, available), cluster.point)
    if (needed > available) expandedClusterKey.value = cluster.key
}

function onClusterClick(cluster: DotCluster<RouteDot>, event: MouseEvent) {
    if (props.armedRouteId) place(props.armedRouteId, event)
    else openCluster(cluster)
}

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

function ghostAt(
    routeId: string,
    client: { clientX: number; clientY: number },
) {
    const target = snapAt(client)
    ghost.value = target ? { ...target, routeId } : null
}

function previewAt(routeId: string, clientX: number, clientY: number) {
    if (isOverCanvas(clientX, clientY)) ghostAt(routeId, { clientX, clientY })
    else ghost.value = null
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
    expandedClusterKey.value = null
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

let cancelDotDrag: (() => void) | null = null
onBeforeUnmount(() => cancelDotDrag?.())

function onDotDown(routeId: string, event: PointerEvent) {
    if (event.button !== 0) return
    const target = event.currentTarget as SVGElement
    target.setPointerCapture(event.pointerId)
    const start = { x: event.clientX, y: event.clientY }
    let last = start
    let moved = false

    const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return
        last = { x: moveEvent.clientX, y: moveEvent.clientY }
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
        ghostAt(routeId, moveEvent)
    }
    const end = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== event.pointerId) return
        stop()
        if (moved) place(routeId, endEvent)
        else if (props.armedRouteId && props.armedRouteId !== routeId)
            place(props.armedRouteId, endEvent)
        else emit('selectRoute', routeId)
        draggingRouteId.value = null
        ghost.value = null
    }
    const stop = () => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', end)
        target.removeEventListener('pointercancel', cancel)
        window.removeEventListener('pointerdown', secondPointer, true)
        cancelDotDrag = null
    }
    const cancel = () => {
        stop()
        draggingRouteId.value = null
        ghost.value = null
    }
    // A second finger turns the dot drag into a pinch instead of placing the route.
    const secondPointer = (other: PointerEvent) => {
        if (other.pointerId === event.pointerId) return
        cancel()
        if (target.hasPointerCapture(event.pointerId))
            target.releasePointerCapture(event.pointerId)
        panZoom.adoptPointer(event.pointerId, last)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', cancel)
    window.addEventListener('pointerdown', secondPointer, true)
    cancelDotDrag = cancel
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

.placement-wall--tinted .placement-wall-outline {
    fill: color-mix(in oklab, var(--wall-tint) 40%, transparent);
    stroke: var(--wall-tint);
}

.placement-wall--tinted.placement-wall--selected .placement-wall-outline {
    fill: color-mix(in oklab, var(--wall-tint) 60%, transparent);
    stroke: var(--ui-text-highlighted);
    stroke-width: 3;
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

.placement-cluster {
    cursor: pointer;
    outline: none;
}

.placement-cluster-hit {
    fill: transparent;
}

.placement-cluster-body {
    fill: var(--ui-bg-inverted);
    stroke: var(--ui-bg);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
}

.placement-cluster:focus-visible .placement-cluster-body {
    stroke: var(--ui-primary);
}

.placement-cluster-count {
    fill: var(--ui-text-inverted);
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
}

.map-dot.placement-ghost {
    pointer-events: none;
}
</style>
