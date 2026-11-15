<template>
    <Transition
        leave-active-class="transition-[scale,opacity] duration-150"
        :leave-to-class="ios ? 'opacity-0' : 'scale-0'"
    >
        <div
            v-if="ios && (offset || refreshing)"
            aria-hidden="true"
            class="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
            :style="{
                top: `calc(var(--app-top, 64px) + var(--app-top-inset, 0px) + ${(IOS_REST - 24) / 2}px)`,
            }"
        >
            <svg
                data-testid="pull-indicator"
                viewBox="0 0 24 24"
                class="size-6 text-muted"
                :class="refreshing && 'animate-[spin_0.8s_steps(8)_infinite]'"
            >
                <line
                    v-for="spoke in IOS_SPOKES"
                    :key="spoke"
                    x1="12"
                    y1="2.5"
                    x2="12"
                    y2="7"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    :transform="`rotate(${spoke * 45} 12 12)`"
                    :opacity="spokeOpacity(spoke)"
                />
            </svg>
        </div>
        <div
            v-else-if="offset || refreshing"
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
                <svg
                    data-testid="pull-indicator"
                    viewBox="0 0 24 24"
                    class="size-6 text-primary"
                    :class="refreshing && 'animate-spin'"
                    :style="
                        refreshing
                            ? undefined
                            : {
                                  transform: `rotate(${progress * 270}deg)`,
                                  opacity: ready ? 1 : 0.4,
                              }
                    "
                >
                    <circle
                        cx="12"
                        cy="12"
                        r="8"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        :stroke-dasharray="`${arc} ${CIRCUMFERENCE}`"
                        transform="rotate(-90 12 12)"
                    />
                    <polygon
                        v-if="!refreshing"
                        points="11,1 15.5,4 11,7"
                        fill="currentColor"
                        :transform="`rotate(${(arc / CIRCUMFERENCE) * 360} 12 12)`"
                    />
                </svg>
            </div>
        </div>
    </Transition>
</template>

<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { isInstalledApp, isIos } from '~/utils/native'
import {
    canPullFrom,
    claimsTouch,
    PULL_THRESHOLD,
    pullGesture,
    pullOffset,
} from '~/utils/pullToRefresh'

const MIN_SPIN_MS = 500

const offset = ref(0)
const dragging = ref(false)
const refreshing = ref(false)
const atTop = ref(false)
const ios = ref(false)
const IOS_REST = 52
const IOS_SPOKES = [0, 1, 2, 3, 4, 5, 6, 7]
const ready = computed(() => offset.value >= PULL_THRESHOLD)
const CIRCUMFERENCE = 2 * Math.PI * 8
const progress = computed(() => Math.min(1, offset.value / PULL_THRESHOLD))
const arc = computed(() =>
    refreshing.value
        ? CIRCUMFERENCE * 0.75
        : CIRCUMFERENCE * 0.8 * progress.value,
)
let start: { x: number; y: number } | null = null

// iOS fades the spokes in one by one while pulling and trails them behind the lead spoke while spinning.
const spokeOpacity = (spoke: number) =>
    refreshing.value
        ? 1 - (spoke / IOS_SPOKES.length) * 0.75
        : Number(spoke < progress.value * IOS_SPOKES.length)

function settle(event: TransitionEvent) {
    const main = event.currentTarget as HTMLElement
    if (event.target !== main || event.propertyName !== 'top') return
    main.removeEventListener('transitionend', settle)
    if (main.style.top === '0px') main.style.position = ''
}

// iOS keeps the top bar in place and slides the page below it, the spinner sits in the gap.
// A relative offset, unlike a transform, leaves fixed children (save bar) at the viewport.
watch([offset, refreshing, dragging], () => {
    const main = ios.value && document.getElementById('main-content')
    if (!main) return
    const shift = refreshing.value ? IOS_REST : offset.value
    main.style.transition = dragging.value ? '' : 'top 200ms ease-out'
    main.style.top = `${shift}px`
    if (shift) main.style.position = 'relative'
    else if (dragging.value) main.style.position = ''
    else main.addEventListener('transitionend', settle)
})

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
    if (event.touches.length > 1 || event.defaultPrevented) return reset()
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (event.cancelable && claimsTouch(dx, dy)) event.preventDefault()
    if (!dragging.value) {
        const gesture = pullGesture(dx, dy)
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
    if (!isInstalledApp()) return
    ios.value = isIos()
    useEventListener('touchstart', onStart, { passive: true })
    atTop.value = window.scrollY <= 0
    useEventListener('scroll', () => (atTop.value = window.scrollY <= 0), {
        passive: true,
    })
    // Pulls start only at the page top, so only there does scrolling wait for this listener.
    useEventListener(() => (atTop.value ? window : null), 'touchmove', onMove, {
        passive: false,
    })
    useEventListener(['touchend', 'touchcancel'], onEnd)
})
</script>
