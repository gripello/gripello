<script setup lang="ts">
import type { ScreenPoint } from '~/utils/panZoom'
import {
    type ImageZoom,
    pinchZoom,
    toggleZoom,
    UNZOOMED,
    zoomAround,
    clampZoom,
} from '~/utils/imageZoom'

defineProps<{ src: string; alt: string }>()

const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
const TAP_SLOP_PX = 10
const WHEEL_ZOOM_SPEED = 0.004
const TRACKPAD_PINCH_SPEED = 0.02

const frame = useTemplateRef<HTMLElement>('frame')
const zoom = shallowRef(UNZOOMED)
const animated = ref(false)
let current = UNZOOMED
let frameRequest = 0

function show(next: ImageZoom, animate = false) {
    current = next
    animated.value = animate
    if (animate) {
        zoom.value = next
        return
    }
    frameRequest ||= requestAnimationFrame(() => {
        frameRequest = 0
        zoom.value = current
    })
}

onBeforeUnmount(() => cancelAnimationFrame(frameRequest))
const pointers = new Map<number, ScreenPoint>()
let lastTap: (ScreenPoint & { time: number }) | null = null
let travel = 0

function local(event: { clientX: number; clientY: number }): ScreenPoint {
    const rect = frame.value!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function size() {
    const el = frame.value!
    return { width: el.clientWidth, height: el.clientHeight }
}

function onPointerDown(event: PointerEvent) {
    frame.value!.setPointerCapture?.(event.pointerId)
    pointers.set(event.pointerId, local(event))
    if (pointers.size === 1) travel = 0
}

function onPointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    const point = local(event)
    travel += Math.hypot(point.x - previous.x, point.y - previous.y)
    if (pointers.size === 2) {
        const other = [...pointers].find(([id]) => id !== event.pointerId)![1]
        show(pinchZoom(current, [previous, other], [point, other], size()))
    } else if (current.scale > 1) {
        show(
            clampZoom(
                {
                    ...current,
                    x: current.x + point.x - previous.x,
                    y: current.y + point.y - previous.y,
                },
                size(),
            ),
        )
    }
    pointers.set(event.pointerId, point)
}

function onPointerCancel(event: PointerEvent) {
    travel = Infinity
    onPointerUp(event)
}

function onPointerUp(event: PointerEvent) {
    const point = pointers.get(event.pointerId)
    if (
        !pointers.delete(event.pointerId) ||
        pointers.size ||
        travel > TAP_SLOP_PX ||
        !point
    )
        return
    const tap = { ...point, time: Date.now() }
    const isDouble =
        !!lastTap &&
        tap.time - lastTap.time < DOUBLE_TAP_MS &&
        Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < DOUBLE_TAP_PX
    lastTap = isDouble ? null : tap
    if (isDouble) show(toggleZoom(current, tap, size()), true)
}

function onWheel(event: WheelEvent) {
    const speed = event.ctrlKey ? TRACKPAD_PINCH_SPEED : WHEEL_ZOOM_SPEED
    show(
        zoomAround(
            current,
            local(event),
            Math.exp(-event.deltaY * speed),
            size(),
        ),
    )
}
</script>

<template>
    <div
        ref="frame"
        class="relative h-[75dvh] w-full touch-none overflow-hidden select-none"
        :class="zoom.scale > 1 ? 'cursor-grab' : 'cursor-zoom-in'"
        data-testid="zoomable-image"
        :data-zoom="zoom.scale"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
        @wheel.prevent="onWheel"
    >
        <img
            :src="src"
            :alt="alt"
            draggable="false"
            class="size-full origin-top-left object-contain will-change-transform"
            :class="animated && 'transition-transform duration-200 ease-out'"
            :style="{
                transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            }"
            data-testid="image-viewer-full"
        />
    </div>
</template>
