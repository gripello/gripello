<template>
    <div class="map-view" data-testid="map-view">
        <MapCanvas
            :pan-zoom="panZoom"
            :label="$t('map.label')"
            data-testid="map-svg"
            @click="onBackgroundClick"
        >
            <MapFloorLayer :shapes="map.shapes" />

            <g
                v-for="wall in mapWalls"
                :key="wall.id"
                class="map-wall"
                :class="{ 'map-wall--selected': wall.id === selectedWallId }"
                role="button"
                tabindex="0"
                :aria-pressed="wall.id === selectedWallId"
                :aria-label="wallAriaLabel(wall)"
                data-testid="map-wall"
                :data-name="wall.name"
                @click.stop="emit('selectWall', wall.id)"
                @keydown.enter.prevent="emit('selectWall', wall.id)"
                @keydown.space.prevent="emit('selectWall', wall.id)"
            >
                <path :d="svgPath(wall.outline)" class="map-wall-outline" />
            </g>

            <g class="map-dots">
                <line
                    v-for="dot in shownDots.filter((item) => item.from)"
                    :key="`leader-${dot.routeId}`"
                    :x1="dot.from![0]"
                    :y1="dot.from![1]"
                    :x2="dot.at[0]"
                    :y2="dot.at[1]"
                    class="map-dot-leader"
                />
                <MapRouteMarker
                    v-for="dot in shownDots"
                    :key="dot.routeId"
                    :at="dot.at"
                    :fill="dot.fill"
                    :stroke="dot.stroke"
                    :grade="dot.grade"
                    :as-grade="dot.asGrade"
                    :is-new="dot.isNew"
                    :sent="!!sentIds?.has(dot.routeId)"
                    :defect="defects?.get(dot.routeId)"
                    :selected="dot.routeId === selectedRouteId"
                    :pixels-per-unit="pixelsPerUnit"
                    :hit-radius-px="hitRadiusPx"
                    :class="{
                        'map-dot--dimmed': isDimmed(dot.routeId),
                        'map-dot--selected': dot.routeId === selectedRouteId,
                    }"
                    data-testid="map-route-dot"
                    :data-route-id="dot.routeId"
                    :data-color="dot.fill"
                    :data-sent="sentIds?.has(dot.routeId) || undefined"
                    :data-defect="defects?.get(dot.routeId)"
                    :data-dimmed="isDimmed(dot.routeId) || undefined"
                    role="button"
                    tabindex="0"
                    :aria-pressed="dot.routeId === selectedRouteId"
                    :aria-label="dotLabel(dot.routeId)"
                    @click.stop="emit('selectRoute', dot.routeId)"
                    @keydown.enter.prevent="emit('selectRoute', dot.routeId)"
                    @keydown.space.prevent="emit('selectRoute', dot.routeId)"
                />
                <g
                    v-for="cluster in collapsedClusters"
                    :key="cluster.key"
                    class="map-cluster"
                    :class="{
                        'map-dot--dimmed': cluster.dots.every((dot) =>
                            isDimmed(dot.routeId),
                        ),
                    }"
                    data-testid="map-route-cluster"
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
                    @click.stop="openCluster(cluster)"
                    @keydown.enter.prevent="openCluster(cluster)"
                    @keydown.space.prevent="openCluster(cluster)"
                >
                    <circle
                        :cx="cluster.point[0]"
                        :cy="cluster.point[1]"
                        :r="dotHitRadius"
                        class="map-dot-hit"
                    />
                    <circle
                        :cx="cluster.point[0]"
                        :cy="cluster.point[1]"
                        :r="clusterRadius"
                        class="map-cluster-body"
                    />
                    <g
                        :transform="`translate(${cluster.point[0]} ${cluster.point[1]}) scale(${1 / pixelsPerUnit})`"
                    >
                        <text
                            :font-size="CLUSTER_FONT_PX"
                            class="map-cluster-count"
                        >
                            {{ cluster.dots.length }}
                        </text>
                    </g>
                </g>
            </g>
            <template #overlay>
                <div v-if="size.width" class="map-labels">
                    <button
                        v-for="label in labels"
                        :key="label.id"
                        type="button"
                        tabindex="-1"
                        class="wall-pill"
                        :class="{
                            'wall-pill--selected': label.id === selectedWallId,
                        }"
                        :style="{ left: `${label.x}px`, top: `${label.y}px` }"
                        data-testid="map-wall-label"
                        :data-name="label.name"
                        @click="emit('selectWall', label.id)"
                    >
                        <span class="wall-pill__name">{{ label.name }}</span>
                        <span
                            class="wall-pill__count"
                            data-testid="map-wall-count"
                            >{{ label.count }}</span
                        >
                    </button>
                </div>
            </template>
        </MapCanvas>
    </div>
</template>

<script setup lang="ts">
import {
    boundsOf,
    type GymMap,
    type MapBounds,
    type MapPoint,
} from '#shared/utils/mapGeometry'
import type { WallRecord } from '~/types/models'
import {
    clearOfDots,
    closestPairDistance,
    clusterDots,
    GRADE_RADIUS_PX,
    GRADE_SPACING_PX,
    HIT_RADIUS_PX,
    isolatedIds,
    placeRoutes,
    spreadAround,
    type DotCluster,
    type RouteDot,
    toMapWalls,
    visibleLabels,
    wallCounts,
    type MapRoute,
    type MapWall,
} from '~/utils/gymMap'
import { translatedColorName } from '~/utils/colorName'
import { mapToScreen } from '~/utils/panZoom'
import { svgPath } from '~/utils/mapSvg'
import type { DefectSeverity } from '~/utils/tasks'

const props = withDefaults(
    defineProps<{
        map: GymMap
        walls: WallRecord[]
        routes: MapRoute[]
        layoutRoutes?: MapRoute[] | null
        sentIds?: ReadonlySet<string> | null
        defects?: ReadonlyMap<string, DefectSeverity> | null
        matchingIds?: ReadonlySet<string> | null
        showSent?: boolean
        selectedWallId?: string | null
        selectedRouteId?: string | null
        insetBottom?: number
    }>(),
    {
        insetBottom: 0,
        layoutRoutes: null,
        sentIds: null,
        defects: null,
        matchingIds: null,
        showSent: false,
        selectedWallId: null,
        selectedRouteId: null,
    },
)

const emit = defineEmits<{
    selectWall: [wallId: string | null]
    selectRoute: [routeId: string]
}>()

const CLUSTER_RADIUS_PX = 11
const CLUSTER_FONT_PX = 12
const SPREAD_HIT_RADII = 2.2
const LABEL_HEIGHT_PX = 24
const LABEL_CHAR_PX = 7
const LABEL_PADDING_PX = 24
const LABEL_EDGE_PX = 4
const MAX_PIXELS_PER_METRE = 400
const CONTROLS_WIDTH_PX = 64
const CONTROLS_HEIGHT_PX = 160
const FOCUS_PADDING = 2
const ROUTE_FOCUS_RADIUS = 4

const { t } = useI18n()
const bounds = computed<MapBounds>(() => ({
    minX: 0,
    minY: 0,
    maxX: props.map.width,
    maxY: props.map.height,
}))

const panZoom = useSvgPanZoom({
    bounds,
    minWidth: 1,
    maxPixelsPerUnit: MAX_PIXELS_PER_METRE,
    doubleClickZoom: true,
    insetBottom: computed(() => props.insetBottom ?? 0),
})
const { viewBox, size, pixelsPerUnit, fitTo, fitAll, zoomBy, limits } = panZoom
const coarsePointer = useCoarsePointer()
const hitRadiusPx = computed(() =>
    coarsePointer.value ? HIT_RADIUS_PX.coarse : HIT_RADIUS_PX.fine,
)

const mapWalls = computed(() => toMapWalls(props.walls, props.map))
const dots = computed(() => placeRoutes(mapWalls.value, props.routes))
const layoutDots = computed(() =>
    props.layoutRoutes
        ? placeRoutes(mapWalls.value, props.layoutRoutes)
        : dots.value,
)
const counts = computed(() =>
    wallCounts(props.routes, props.sentIds ?? new Set(), props.matchingIds),
)

const gradeSpacing = computed(() => GRADE_SPACING_PX / pixelsPerUnit.value)
const dotSpacing = computed(() => (hitRadiusPx.value * 2) / pixelsPerUnit.value)
const spreadSpacing = computed(() =>
    Math.max(
        (hitRadiusPx.value * SPREAD_HIT_RADII) / pixelsPerUnit.value,
        gradeSpacing.value,
    ),
)
const gradeHitPx = computed(() => Math.max(hitRadiusPx.value, GRADE_RADIUS_PX))

const dotHitRadius = computed(() => hitRadiusPx.value / pixelsPerUnit.value)
const clusterRadius = computed(() => CLUSTER_RADIUS_PX / pixelsPerUnit.value)

function markerClusters(routeDots: RouteDot[]) {
    const isolated = isolatedIds(routeDots, gradeSpacing.value)
    const singles = routeDots
        .filter((dot) => isolated.has(dot.routeId))
        .map((dot) => ({ key: dot.routeId, point: dot.point, dots: [dot] }))
    const crowded = routeDots.filter((dot) => !isolated.has(dot.routeId))
    return {
        isolated,
        clusters: [...singles, ...clusterDots(crowded, dotSpacing.value)],
    }
}

const expandedClusterKey = ref<string | null>(null)
const markers = computed(() => markerClusters(dots.value))

function isExpanded(cluster: DotCluster<RouteDot>) {
    return (
        cluster.key === expandedClusterKey.value ||
        cluster.dots.some((dot) => dot.routeId === props.selectedRouteId)
    )
}

const collapsedClusters = computed(() =>
    markers.value.clusters.filter(
        (cluster) => cluster.dots.length > 1 && !isExpanded(cluster),
    ),
)

const shownDots = computed(() =>
    markers.value.clusters.flatMap(
        (
            cluster,
        ): (RouteDot & {
            at: MapPoint
            from?: MapPoint
            asGrade: boolean
        })[] => {
            if (cluster.dots.length === 1) {
                const dot = cluster.dots[0]!
                return [
                    {
                        ...dot,
                        at: dot.point,
                        asGrade: markers.value.isolated.has(dot.routeId),
                    },
                ]
            }
            if (!isExpanded(cluster)) return []
            const spread = spreadAround(
                cluster.point,
                cluster.dots.length,
                spreadSpacing.value,
            )
            return cluster.dots.map((dot, index) => ({
                ...dot,
                at: spread[index]!,
                from: cluster.point,
                asGrade: true,
            }))
        },
    ),
)

function openCluster(cluster: DotCluster<RouteDot>) {
    const needed =
        spreadSpacing.value /
        closestPairDistance(cluster.dots.map((dot) => dot.point))
    const available = viewBox.value.width / limits.value.minWidth
    zoomBy(Math.min(needed, available), cluster.point)
    if (needed > available) expandedClusterKey.value = cluster.key
}

function onBackgroundClick() {
    expandedClusterKey.value = null
    emit('selectWall', null)
}

function isDimmed(routeId: string) {
    return !!props.matchingIds && !props.matchingIds.has(routeId)
}

function countText(wall: MapWall) {
    const count = counts.value.get(wall.id) ?? { total: 0, sent: 0 }
    return props.showSent ? `${count.sent}/${count.total}` : `${count.total}`
}

function wallAriaLabel(wall: MapWall) {
    const count = counts.value.get(wall.id) ?? { total: 0, sent: 0 }
    return props.showSent
        ? t('map.wallSentLabel', {
              name: wall.name,
              sent: count.sent,
              total: count.total,
          })
        : t('map.wallTotalLabel', { name: wall.name, total: count.total })
}

const routesById = computed(
    () => new Map(props.routes.map((route) => [route.id, route])),
)

function dotLabel(routeId: string) {
    const route = routesById.value.get(routeId)
    return [
        route?.name,
        translatedColorName(t, route?.color),
        props.sentIds?.has(routeId) && t('ticks.sent'),
        props.defects?.has(routeId) && t('tasks.defect.marker'),
    ]
        .filter(Boolean)
        .join(', ')
}

const labels = computed(() => {
    const screenDots = markerClusters(layoutDots.value).clusters.map(
        (cluster) => mapToScreen(cluster.point, size.value, viewBox.value),
    )
    const mapCentreY = mapToScreen(
        [props.map.width / 2, props.map.height / 2],
        size.value,
        viewBox.value,
    ).y
    const placed = mapWalls.value.flatMap((wall) => {
        const position = mapToScreen(wall.labelAt, size.value, viewBox.value)
        const count = countText(wall)
        const width =
            (wall.name.length + count.length + 3) * LABEL_CHAR_PX +
            LABEL_PADDING_PX
        const offScreen =
            position.x < -width / 2 ||
            position.x > size.value.width + width / 2 ||
            position.y < -LABEL_HEIGHT_PX ||
            position.y > size.value.height + LABEL_HEIGHT_PX
        if (offScreen) return []
        const box = clearOfDots(
            {
                id: wall.id,
                x: position.x,
                y: position.y,
                width,
                height: LABEL_HEIGHT_PX,
            },
            screenDots,
            gradeHitPx.value,
            LABEL_EDGE_PX,
            position.y < mapCentreY ? 1 : -1,
        )
        const y = clampInside(box.y, LABEL_HEIGHT_PX, size.value.height)
        const nearControls = y - LABEL_HEIGHT_PX / 2 < CONTROLS_HEIGHT_PX
        const x = clampInside(
            box.x,
            width,
            size.value.width - (nearControls ? CONTROLS_WIDTH_PX : 0),
        )
        return [{ ...box, name: wall.name, count, x, y }]
    })
    const visible = visibleLabels(placed, props.selectedWallId)
    return placed.filter((label) => visible.has(label.id))
})

function clampInside(center: number, extent: number, limit: number) {
    const margin = extent / 2 + LABEL_EDGE_PX
    if (limit < margin * 2) return limit / 2
    return Math.min(limit - margin, Math.max(margin, center))
}

function focusWall(wallId: string) {
    const wall = mapWalls.value.find((candidate) => candidate.id === wallId)
    const wallBounds = wall && boundsOf([...wall.outline, ...wall.edge])
    if (wallBounds) fitTo(wallBounds, { padding: FOCUS_PADDING })
}

function focusRoute(routeId: string) {
    const dot = dots.value.find((candidate) => candidate.routeId === routeId)
    if (!dot) return
    const [x, y] = dot.point
    fitTo({
        minX: x - ROUTE_FOCUS_RADIUS,
        minY: y - ROUTE_FOCUS_RADIUS,
        maxX: x + ROUTE_FOCUS_RADIUS,
        maxY: y + ROUTE_FOCUS_RADIUS,
    })
}

watch(
    () => [props.map.width, props.map.height],
    () => fitAll(),
)

defineExpose({ focusWall, focusRoute, fitAll })
</script>

<style scoped>
.map-view {
    position: relative;
    width: 100%;
    height: 100%;
}

.map-wall {
    cursor: pointer;
    outline: none;
}

.map-wall-outline {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 32%, transparent);
    stroke: color-mix(in oklab, var(--ui-text-highlighted) 30%, transparent);
    stroke-width: 1;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    transition: fill 0.15s;
}

.map-wall:hover .map-wall-outline,
.map-wall:focus-visible .map-wall-outline {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 40%, transparent);
}

.map-wall:focus-visible .map-wall-outline {
    stroke: var(--ui-primary);
    stroke-width: 2;
}

.map-wall--selected .map-wall-outline {
    fill: color-mix(in oklab, var(--ui-primary) 22%, transparent);
    stroke: var(--ui-primary);
    stroke-width: 2;
}

.map-dot--dimmed {
    opacity: 0.2;
}

.map-dot-hit {
    fill: transparent;
}

.map-cluster {
    cursor: pointer;
    outline: none;
    transition: opacity 0.2s;
}

.map-cluster-body {
    fill: var(--ui-bg-inverted);
    stroke: var(--ui-bg);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
}

.map-cluster:focus-visible .map-cluster-body {
    stroke: var(--ui-primary);
}

.map-cluster-count {
    fill: var(--ui-text-inverted);
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
}

.map-dot-leader {
    stroke: var(--ui-text-muted);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
}

.map-labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.wall-pill {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: baseline;
    gap: 6px;
    pointer-events: auto;
    padding: 2px 10px;
    border: 0;
    border-radius: 999px;
    background: var(--ui-primary);
    color: #fff;
    font-size: 0.8125rem;
    line-height: 1.4;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    white-space: nowrap;
}

.wall-pill--selected {
    outline: 3px solid color-mix(in oklab, var(--ui-primary) 35%, transparent);
}

.wall-pill__name {
    font-weight: 600;
}

.wall-pill__count {
    font-weight: 500;
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
}

.wall-pill__count::before {
    content: '· ';
}
</style>
