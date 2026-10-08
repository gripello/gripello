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
    background: color-mix(in oklab, var(--ui-text-highlighted) 3%, transparent);
}

.map-canvas__svg {
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
