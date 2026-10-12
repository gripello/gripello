<template>
    <g class="floor-layer">
        <template v-for="(shape, index) in shapes" :key="index">
            <path
                :d="svgPath(shape.points, !isOpenShape(shape.kind))"
                class="floor-shape"
                :class="[
                    `floor-shape--${shape.kind}`,
                    shape.level ? `floor-shape--level-${shape.level}` : '',
                    { 'floor-shape--selected': index === selectedIndex },
                ]"
                data-testid="map-floor-shape"
                :data-kind="shape.kind"
                :role="selectable ? 'button' : undefined"
                :tabindex="selectable ? 0 : undefined"
                :aria-pressed="selectable ? index === selectedIndex : undefined"
                :aria-label="
                    selectable ? $t(`mapEditor.kinds.${shape.kind}`) : undefined
                "
                @click="emit('shapeClick', index, $event)"
                @keydown.enter.prevent="
                    selectable && emit('shapeClick', index, $event)
                "
                @keydown.space.prevent="
                    selectable && emit('shapeClick', index, $event)
                "
            />
        </template>
        <g
            v-for="marker in markers"
            :key="`marker-${marker.index}`"
            class="floor-marker"
            :class="`floor-marker--${marker.kind}`"
            :transform="marker.transform"
            pointer-events="none"
            data-testid="map-floor-marker"
            :data-kind="marker.kind"
        >
            <circle cx="12" cy="12" r="17" class="floor-marker__disc" />
            <path
                v-for="(d, part) in MARKER_PATHS[marker.kind]"
                :key="part"
                :d="d"
                class="floor-marker__icon"
            />
        </g>
    </g>
</template>

<script setup lang="ts">
import {
    boundsOf,
    isOpenShape,
    labelPoint,
    type MapShape,
} from '#shared/utils/mapGeometry'
import { svgPath } from '~/utils/mapSvg'

const props = defineProps<{
    shapes: MapShape[]
    selectedIndex?: number | null
    selectable?: boolean
    pixelsPerUnit?: number
}>()

const emit = defineEmits<{
    shapeClick: [index: number, event: Event]
}>()

type MarkerKind = 'path' | 'entrance'

const MARKER_PX = 16
const MARKER_MIN_SHAPE_PX = 40

// Lucide footprints / door-open, drawn on a 24 × 24 grid.
const MARKER_PATHS: Record<MarkerKind, string[]> = {
    path: [
        'M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0m16 4v-2.38c0-2.12 1.03-3.12 1-5.62c-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0m-4-3h4M4 13h4',
    ],
    entrance: [
        'M10 21H2m8-18H7a2 2 0 0 0-2 2v16m9-9h.01',
        'M19 21V5a2 2 0 0 0-1.675-1.974l-6.163-1.013A1 1 0 0 0 10 3v18a1 1 0 0 0 1.124.992zm3 0h-3',
    ],
}

const isMarkerKind = (kind: string): kind is MarkerKind =>
    kind === 'path' || kind === 'entrance'

const markers = computed(() => {
    const scale = props.pixelsPerUnit
    if (!scale) return []
    return props.shapes.flatMap((shape, index) => {
        const bounds = boundsOf(shape.points)
        if (!isMarkerKind(shape.kind) || !bounds) return []
        const smallest = Math.min(
            bounds.maxX - bounds.minX,
            bounds.maxY - bounds.minY,
        )
        if (smallest * scale < MARKER_MIN_SHAPE_PX) return []
        const [x, y] = labelPoint(shape.points)
        const size = MARKER_PX / 24 / scale
        return [
            {
                index,
                kind: shape.kind,
                transform: `translate(${x} ${y}) scale(${size}) translate(-12 -12)`,
            },
        ]
    })
})
</script>

<style scoped>
.floor-shape {
    stroke: color-mix(in oklab, var(--ui-text-highlighted) 30%, transparent);
    stroke-width: 1;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
}

.floor-shape--floor {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 4%, var(--ui-bg));
}

.floor-shape--mat {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 10%, var(--ui-bg));
    stroke: color-mix(in oklab, var(--ui-text-highlighted) 16%, transparent);
}

.floor-shape--structure {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 24%, var(--ui-bg));
    stroke: color-mix(in oklab, var(--ui-bg) 70%, transparent);
}

.floor-shape--path {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 7%, var(--ui-bg));
    stroke: color-mix(in oklab, var(--ui-text-highlighted) 10%, transparent);
}

.floor-shape--entrance {
    fill: color-mix(
        in oklab,
        var(--ui-secondary) 8%,
        color-mix(in oklab, var(--ui-text-highlighted) 4%, var(--ui-bg))
    );
    stroke: color-mix(in oklab, var(--ui-secondary) 35%, transparent);
}

.floor-marker__disc {
    fill: var(--ui-bg);
    opacity: 0.7;
}

.floor-marker__icon {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.floor-marker--path .floor-marker__icon {
    stroke: var(--ui-text-dimmed);
}

.floor-marker--entrance .floor-marker__icon {
    stroke: color-mix(in oklab, var(--ui-secondary) 75%, var(--ui-text-muted));
}

.floor-shape--line {
    fill: none;
    stroke: color-mix(in oklab, var(--ui-text-highlighted) 55%, transparent);
    stroke-width: 2;
    stroke-linecap: round;
}

.floor-shape--structure.floor-shape--level-2 {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 33%, var(--ui-bg));
}

.floor-shape--structure.floor-shape--level-3 {
    fill: color-mix(in oklab, var(--ui-text-highlighted) 42%, var(--ui-bg));
}

.floor-shape:focus-visible {
    stroke: var(--ui-primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
}

.floor-shape--selected {
    stroke: var(--ui-primary);
    stroke-width: 2;
    stroke-dasharray: 6 4;
}
</style>
