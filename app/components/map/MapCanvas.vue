<template>
    <div class="map-canvas">
        <svg
            :ref="bindSvg"
            v-bind="$attrs"
            class="map-canvas__svg"
            :class="{ 'map-canvas__svg--panning': panZoom.isPanning.value }"
            :style="panZoom.isPanning.value ? undefined : { cursor }"
            :viewBox="panZoom.viewBoxAttr.value"
            preserveAspectRatio="xMidYMid meet"
            tabindex="0"
            :role="role"
            :aria-label="label"
        >
            <slot />
        </svg>
        <slot name="overlay" />
        <div class="map-canvas__controls" data-pan-ignore>
            <UButton
                icon="i-lucide-plus"
                size="lg"
                color="neutral"
                variant="outline"
                class="icon-btn shadow-md"
                :aria-label="$t('map.zoomIn')"
                data-testid="map-zoom-in"
                @click="panZoom.zoomBy(1.5)"
            />
            <UButton
                icon="i-lucide-minus"
                size="lg"
                color="neutral"
                variant="outline"
                class="icon-btn shadow-md"
                :aria-label="$t('map.zoomOut')"
                data-testid="map-zoom-out"
                @click="panZoom.zoomBy(1 / 1.5)"
            />
            <UButton
                icon="i-lucide-scan"
                size="lg"
                color="neutral"
                variant="outline"
                class="icon-btn shadow-md"
                :aria-label="$t('map.fit')"
                data-testid="map-fit"
                @click="panZoom.fitAll(true)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { SvgPanZoom } from '~/composables/useSvgPanZoom'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
    defineProps<{
        panZoom: SvgPanZoom
        label: string
        role?: 'group' | 'application'
        cursor?: string
    }>(),
    { role: 'group', cursor: undefined },
)

function bindSvg(element: unknown) {
    props.panZoom.svgRef.value = element as SVGSVGElement | null
}
</script>

<style scoped>
.map-canvas {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    touch-action: none;
    background: color-mix(
        in oklab,
        var(--ui-text-highlighted) 5%,
        var(--ui-bg)
    );
}

.map-canvas::before {
    content: '';
    position: absolute;
    inset: 0;
    background: color-mix(
        in oklab,
        var(--ui-text-highlighted) 12%,
        transparent
    );
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='230' height='170' viewBox='0 0 230 170'%3E%3Cg transform='translate(22 26) scale(0.34) translate(-31 -30)'%3E%3Cpolyline points='12,45 24,23 34,34 44,16 50,26' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='44' cy='16' r='3.5' fill='black'/%3E%3C/g%3E%3Cg transform='translate(118 14) scale(0.26) translate(-31 -30)'%3E%3Cpolyline points='12,45 24,23 34,34 44,16 50,26' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='44' cy='16' r='3.5' fill='black'/%3E%3C/g%3E%3Cg transform='translate(74 78) scale(0.4) translate(-31 -30)'%3E%3Cpolyline points='12,45 24,23 34,34 44,16 50,26' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='44' cy='16' r='3.5' fill='black'/%3E%3C/g%3E%3Cg transform='translate(160 96) scale(0.3) translate(-31 -30)'%3E%3Cpolyline points='12,45 24,23 34,34 44,16 50,26' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='44' cy='16' r='3.5' fill='black'/%3E%3C/g%3E%3Cg transform='translate(30 128) scale(0.26) translate(-31 -30)'%3E%3Cpolyline points='12,45 24,23 34,34 44,16 50,26' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='44' cy='16' r='3.5' fill='black'/%3E%3C/g%3E%3Cg transform='translate(126 150) scale(0.36) translate(-31 -30)'%3E%3Cpolyline points='12,45 24,23 34,34 44,16 50,26' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='44' cy='16' r='3.5' fill='black'/%3E%3C/g%3E%3Cg transform='translate(196 44) scale(0.22) translate(-31 -30)'%3E%3Cpolyline points='12,45 24,23 34,34 44,16 50,26' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='44' cy='16' r='3.5' fill='black'/%3E%3C/g%3E%3Cg transform='translate(208 138) scale(0.28) translate(-31 -30)'%3E%3Cpolyline points='12,45 24,23 34,34 44,16 50,26' fill='none' stroke='black' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='44' cy='16' r='3.5' fill='black'/%3E%3C/g%3E%3C/svg%3E")
        repeat;
    pointer-events: none;
}

:global(.dark) .map-canvas::before {
    background: color-mix(in oklab, var(--ui-text-highlighted) 5%, transparent);
}

.map-canvas__svg {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    outline: none;
    cursor: grab;
}

.map-canvas__svg:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ui-primary);
}

.map-canvas__svg--panning {
    cursor: grabbing;
}

.map-canvas__controls {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

@media (pointer: coarse) {
    .map-canvas__controls {
        gap: 4px;
        opacity: 0.92;
    }
}
</style>
