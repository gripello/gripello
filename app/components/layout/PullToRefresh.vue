<template>
    <div
        v-if="offset || refreshing"
        aria-hidden="true"
        class="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
        :class="!dragging && 'transition-transform duration-200'"
        :style="{
            top: 'calc(var(--app-top, 64px) + var(--app-top-inset, 0px) - 2.75rem)',
            transform: `translateY(${refreshing ? PULL_THRESHOLD : offset}px)`,
        }"
    >
        <div
            class="flex size-10 items-center justify-center rounded-full bg-elevated shadow-md ring ring-default"
        >
            <UIcon
                name="i-lucide-refresh-cw"
                class="size-5 text-primary"
                :class="refreshing && 'animate-spin'"
                :style="
                    refreshing
                        ? undefined
                        : {
                              transform: `rotate(${offset * 3}deg)`,
                              opacity: ready ? 1 : 0.5,
                          }
                "
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { isNativeApp } from '~/utils/native'
import {
    canPullFrom,
    PULL_THRESHOLD,
    pullGesture,
    pullOffset,
} from '~/utils/pullToRefresh'

const MIN_SPIN_MS = 500

const offset = ref(0)
const dragging = ref(false)
const refreshing = ref(false)
const ready = computed(() => offset.value >= PULL_THRESHOLD)
let start: { x: number; y: number } | null = null

function reset() {
    start = null
    dragging.value = false
    offset.value = 0
}

function onStart(event: TouchEvent) {
    const touch = event.touches[0]
    start =
        !refreshing.value &&
        touch &&
        event.touches.length === 1 &&
        canPullFrom(event.target as Element, window.scrollY)
            ? { x: touch.clientX, y: touch.clientY }
            : null
}

function onMove(event: TouchEvent) {
    const touch = event.touches[0]
    if (!start || !touch) return
    if (event.touches.length > 1) return reset()
    const dy = touch.clientY - start.y
    if (!dragging.value) {
        const gesture = pullGesture(touch.clientX - start.x, dy)
        if (gesture === 'undecided') return
        if (gesture === 'cancel') return reset()
        dragging.value = true
    }
    offset.value = pullOffset(dy)
}

async function onEnd() {
    if (!start) return
    start = null
    dragging.value = false
    const shouldRefresh = ready.value
    offset.value = 0
    if (!shouldRefresh) return
    refreshing.value = true
    await Promise.allSettled([
        refreshNuxtData(),
        new Promise((done) => setTimeout(done, MIN_SPIN_MS)),
    ])
    refreshing.value = false
}

onMounted(() => {
    if (!isNativeApp()) return
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
})

onBeforeUnmount(() => {
    window.removeEventListener('touchstart', onStart)
    window.removeEventListener('touchmove', onMove)
    window.removeEventListener('touchend', onEnd)
    window.removeEventListener('touchcancel', onEnd)
})
</script>
