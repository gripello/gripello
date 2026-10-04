<template>
    <g class="map-dot">
        <circle
            v-if="isNew && !asGrade"
            :cx="at[0]"
            :cy="at[1]"
            :r="dotRadius * 1.9"
            :fill="fill"
            class="map-dot-halo"
        />
        <circle :cx="at[0]" :cy="at[1]" :r="hitRadius" class="map-dot-hit" />
        <circle
            :cx="at[0]"
            :cy="at[1]"
            :r="asGrade ? gradeRadius : dotRadius"
            :fill="fill"
            :stroke="stroke"
            class="map-dot-body"
        />
        <template v-if="asGrade">
            <text
                v-if="grade"
                :x="at[0]"
                :y="at[1]"
                :font-size="gradeFontPx(grade) / pixelsPerUnit"
                :fill="stroke"
                class="map-dot-grade"
                data-testid="map-dot-grade"
            >
                {{ grade }}
            </text>
            <g
                v-for="badge in badges"
                :key="badge.kind"
                class="map-dot-badge"
                :class="`map-dot-badge--${badge.kind}`"
            >
                <title>{{ badge.title }}</title>
                <circle :cx="badge.at[0]" :cy="badge.at[1]" :r="badgeRadius" />
                <path
                    v-if="badge.kind === 'sent'"
                    :d="checkPath(badge.at, badgeRadius)"
                    class="map-dot-badge-check"
                />
            </g>
        </template>
        <template v-else>
            <path
                v-if="sent"
                :d="checkPath(at, dotRadius)"
                :stroke="stroke"
                class="map-dot-check"
            />
            <circle
                v-if="defect"
                :cx="at[0] + dotRadius * 0.85"
                :cy="at[1] - dotRadius * 0.85"
                :r="dotRadius * 0.5"
                class="map-dot-defect"
                :class="`map-dot-defect--${defect}`"
                data-testid="map-dot-defect"
            />
        </template>
        <circle
            v-if="selected"
            :cx="at[0]"
            :cy="at[1]"
            :r="asGrade ? gradeRadius * 1.35 : dotRadius * 2.2"
            class="map-dot-ring"
        />
    </g>
</template>

<script setup lang="ts">
import type { MapPoint } from '#shared/utils/mapGeometry'
import {
    BADGE_RADIUS_PX,
    DOT_RADIUS_PX,
    GRADE_RADIUS_PX,
    checkPath,
    gradeFontPx,
} from '~/utils/gymMap'
import type { DefectSeverity } from '~/utils/tasks'

const props = withDefaults(
    defineProps<{
        at: MapPoint
        fill: string
        stroke: string
        grade?: string
        asGrade?: boolean
        pixelsPerUnit: number
        hitRadiusPx: number
        selected?: boolean
        sent?: boolean
        defect?: DefectSeverity | null
        isNew?: boolean
    }>(),
    { grade: '', defect: null },
)

const BADGE_ANGLES = [-Math.PI / 4, 0, -Math.PI / 2]

const { t } = useI18n()
const dotRadius = computed(() => DOT_RADIUS_PX / props.pixelsPerUnit)
const gradeRadius = computed(() => GRADE_RADIUS_PX / props.pixelsPerUnit)
const badgeRadius = computed(() => BADGE_RADIUS_PX / props.pixelsPerUnit)
const hitRadius = computed(
    () =>
        (props.asGrade
            ? Math.max(props.hitRadiusPx, GRADE_RADIUS_PX)
            : props.hitRadiusPx) / props.pixelsPerUnit,
)

const badges = computed(() => {
    const shown = [
        props.sent && { kind: 'sent', title: t('ticks.sent') },
        props.defect && {
            kind: `defect-${props.defect}`,
            title: t('tasks.defect.marker'),
        },
        props.isNew && { kind: 'new', title: t('ticks.suggestions.new') },
    ].filter((badge) => !!badge)
    const distance = gradeRadius.value * 0.95
    return shown.map(({ kind, title }, index) => ({
        kind,
        title,
        at: [
            props.at[0] + distance * Math.cos(BADGE_ANGLES[index]!),
            props.at[1] + distance * Math.sin(BADGE_ANGLES[index]!),
        ] as MapPoint,
    }))
})
</script>

<style scoped>
.map-dot {
    cursor: pointer;
    transition: opacity 0.2s;
}

.map-dot:focus {
    outline: none;
}

.map-dot:focus-visible .map-dot-hit {
    stroke: var(--ui-primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
}

.map-dot-hit {
    fill: transparent;
}

.map-dot-halo {
    opacity: 0.3;
}

.map-dot-body {
    stroke-width: 1.25;
    vector-effect: non-scaling-stroke;
}

.map-dot-check {
    fill: none;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
}

.map-dot-grade {
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
}

.map-dot-badge circle {
    stroke: var(--ui-bg);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
}

.map-dot-badge--sent circle {
    fill: var(--ui-success);
}

.map-dot-badge--new circle {
    fill: var(--ui-primary);
}

.map-dot-badge--defect-urgent circle {
    fill: var(--ui-error);
}

.map-dot-badge--defect-minor circle {
    fill: var(--ui-warning);
}

.map-dot-badge-check {
    fill: none;
    stroke: var(--ui-bg);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
}

.map-dot-defect {
    stroke: var(--ui-bg);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
}

.map-dot-defect--urgent {
    fill: var(--ui-error);
}

.map-dot-defect--minor {
    fill: var(--ui-warning);
}

.map-dot-ring {
    fill: none;
    stroke: var(--ui-primary);
    stroke-width: 2.5;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
    animation: dot-pulse 1.4s ease-out infinite;
    transform-box: fill-box;
    transform-origin: center;
}

@keyframes dot-pulse {
    0% {
        opacity: 1;
        transform: scale(0.7);
    }
    100% {
        opacity: 0;
        transform: scale(1.5);
    }
}

@media (prefers-reduced-motion: reduce) {
    .map-dot-ring {
        animation: none;
    }
}
</style>
