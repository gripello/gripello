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
            <g
                v-if="grade"
                :transform="`translate(${at[0]} ${at[1]}) scale(${1 / pixelsPerUnit})`"
            >
                <text
                    :font-size="gradeFontPx(grade)"
                    :fill="stroke"
                    class="map-dot-grade"
                    data-testid="map-dot-grade"
                >
                    {{ grade }}
                </text>
            </g>
            <g
                v-for="badge in badges"
                :key="badge.kind"
                class="map-dot-badge"
                :class="`map-dot-badge--${badge.kind}`"
            >
                <title>{{ badge.title }}</title>
                <circle :cx="badge.at[0]" :cy="badge.at[1]" :r="badgeRadius" />
                <path
                    :d="badge.glyph(badge.at, badgeRadius)"
                    class="map-dot-badge-glyph"
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
            <g
                v-if="defect"
                class="map-dot-defect"
                :class="`map-dot-defect--${defect}`"
                data-testid="map-dot-defect"
            >
                <circle
                    :cx="defectAt[0]"
                    :cy="defectAt[1]"
                    :r="dotRadius * 0.6"
                />
                <path
                    :d="exclamationPath(defectAt, dotRadius * 0.6)"
                    class="map-dot-badge-glyph"
                />
            </g>
        </template>
        <template v-if="selected">
            <circle
                :cx="at[0]"
                :cy="at[1]"
                :r="ringRadius"
                class="map-dot-ring map-dot-ring--still"
            />
            <!-- SMIL instead of a CSS transform: iOS Safari leaves stray lines around transformed SVG -->
            <circle
                :cx="at[0]"
                :cy="at[1]"
                :r="ringRadius"
                class="map-dot-ring map-dot-ring--pulse"
            >
                <animate
                    attributeName="r"
                    :values="`${ringRadius * 0.7};${ringRadius * 1.5}`"
                    dur="1.4s"
                    repeatCount="indefinite"
                />
                <animate
                    attributeName="opacity"
                    values="1;0"
                    dur="1.4s"
                    repeatCount="indefinite"
                />
            </circle>
        </template>
    </g>
</template>

<script setup lang="ts">
import type { MapPoint } from '#shared/utils/mapGeometry'
import {
    BADGE_RADIUS_PX,
    DOT_RADIUS_PX,
    GRADE_RADIUS_PX,
    GRADE_SPACING_PX,
    checkPath,
    exclamationPath,
    gradeFontPx,
    sparklePath,
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

const BADGE_ANGLES = [-Math.PI / 4, (-3 * Math.PI) / 4, -Math.PI / 2]

const { t } = useI18n()
const dotRadius = computed(() => DOT_RADIUS_PX / props.pixelsPerUnit)
const gradeRadius = computed(() => GRADE_RADIUS_PX / props.pixelsPerUnit)
const badgeRadius = computed(() => BADGE_RADIUS_PX / props.pixelsPerUnit)
const ringRadius = computed(() =>
    props.asGrade ? gradeRadius.value * 1.35 : dotRadius.value * 2.2,
)
const hitRadius = computed(
    () =>
        (props.asGrade
            ? Math.max(
                  Math.min(props.hitRadiusPx, GRADE_SPACING_PX / 2),
                  GRADE_RADIUS_PX,
              )
            : props.hitRadiusPx) / props.pixelsPerUnit,
)

const defectAt = computed<MapPoint>(() => [
    props.at[0] + dotRadius.value * 0.85,
    props.at[1] - dotRadius.value * 0.85,
])

const badges = computed(() => {
    const shown = [
        props.sent && {
            kind: 'sent',
            title: t('ticks.sent'),
            glyph: checkPath,
        },
        props.defect && {
            kind: `defect-${props.defect}`,
            title: t('tasks.defect.marker'),
            glyph: exclamationPath,
        },
        props.isNew && {
            kind: 'new',
            title: t('ticks.suggestions.new'),
            glyph: sparklePath,
        },
    ].filter((badge) => !!badge)
    const distance = gradeRadius.value * 0.95
    return shown.map(({ kind, title, glyph }, index) => ({
        kind,
        title,
        glyph,
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
    fill: var(--ui-info);
}

.map-dot-badge--defect-urgent circle {
    fill: var(--ui-error);
}

.map-dot-badge--defect-minor circle {
    fill: var(--ui-warning);
}

.map-dot-badge-glyph {
    fill: none;
    stroke: var(--ui-bg);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
}

.map-dot-badge--new .map-dot-badge-glyph {
    fill: var(--ui-bg);
    stroke-width: 1;
}

.map-dot-defect {
    pointer-events: none;
}

.map-dot-defect circle {
    stroke: var(--ui-bg);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
}

.map-dot-defect--urgent circle {
    fill: var(--ui-error);
}

.map-dot-defect--minor circle {
    fill: var(--ui-warning);
}

.map-dot-ring {
    fill: none;
    stroke: var(--ui-primary);
    stroke-width: 2.5;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
}

.map-dot-ring--still {
    display: none;
}

@media (prefers-reduced-motion: reduce) {
    .map-dot-ring--still {
        display: inline;
    }

    .map-dot-ring--pulse {
        display: none;
    }
}
</style>
