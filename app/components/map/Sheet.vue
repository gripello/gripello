<template>
    <aside
        v-if="mdAndUp"
        class="map-sheet map-sheet--side"
        :class="{ 'map-sheet--collapsed': collapsed }"
        v-bind="$attrs"
    >
        <div class="map-sheet__header">
            <UButton
                :icon="
                    collapsed
                        ? 'i-lucide-panel-right-open'
                        : 'i-lucide-panel-right-close'
                "
                color="neutral"
                variant="ghost"
                class="icon-btn shrink-0"
                :aria-label="$t(collapsed ? 'map.showList' : 'map.hideList')"
                :aria-expanded="!collapsed"
                data-testid="map-sheet-collapse"
                @click="collapsed = !collapsed"
            />
            <slot v-if="!collapsed" name="header" />
        </div>
        <div v-if="!collapsed" class="map-sheet__body">
            <slot />
        </div>
    </aside>
    <section
        v-else
        ref="sheetRef"
        class="map-sheet map-sheet--bottom"
        :class="{ 'map-sheet--dragging': dragHeight !== null }"
        :style="{
            height: `${visibleHeight}px`,
        }"
        v-bind="$attrs"
    >
        <div
            ref="gripRef"
            class="map-sheet__grip"
            @pointerdown="onDragStart"
            @click.capture="onGripClick"
        >
            <button
                type="button"
                class="map-sheet__handle"
                :aria-label="$t('map.resizeList')"
                :aria-expanded="snap !== 'peek'"
                data-testid="map-sheet-handle"
                @click="cycle"
            />
            <div class="map-sheet__header">
                <slot name="header" />
            </div>
        </div>
        <div class="map-sheet__body" :inert="snap === 'peek' || undefined">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
export type SheetSnap = 'peek' | 'half' | 'full'

defineOptions({ inheritAttrs: false })

const snap = defineModel<SheetSnap>('snap', { default: 'peek' })
const emit = defineEmits<{ cover: [height: number] }>()

const HALF_FRACTION = 0.5
const TOP_GAP_PX = 8
const DRAG_THRESHOLD_PX = 6
const FLICK_SPEED = 0.5
const ORDER: SheetSnap[] = ['peek', 'half', 'full']

const { mdAndUp } = useDisplay()
const collapsed = ref(false)
const sheetRef = useTemplateRef<HTMLElement>('sheetRef')
const gripRef = useTemplateRef<HTMLElement>('gripRef')
const containerHeight = ref(0)
const peekHeight = ref(64)
const dragHeight = ref<number | null>(null)
let dragged = false

const fullHeight = computed(() =>
    Math.max(containerHeight.value - TOP_GAP_PX, peekHeight.value),
)
const visibleHeights = computed<Record<SheetSnap, number>>(() => ({
    peek: peekHeight.value,
    half: Math.max(containerHeight.value * HALF_FRACTION, peekHeight.value),
    full: fullHeight.value,
}))
const visibleHeight = computed(
    () => dragHeight.value ?? visibleHeights.value[snap.value],
)

watch(
    [() => mdAndUp.value, () => visibleHeights.value[snap.value]],
    ([desktop, height]) => emit('cover', desktop ? 0 : height),
    { immediate: true },
)

function cycle() {
    const index = ORDER.indexOf(snap.value)
    snap.value = ORDER[(index + 1) % ORDER.length]!
}

function nearestSnap(visible: number, velocity: number): SheetSnap {
    if (Math.abs(velocity) > FLICK_SPEED) {
        const index = ORDER.indexOf(snap.value) + (velocity < 0 ? 1 : -1)
        return ORDER[Math.min(ORDER.length - 1, Math.max(0, index))]!
    }
    return ORDER.reduce((best, candidate) =>
        Math.abs(visibleHeights.value[candidate] - visible) <
        Math.abs(visibleHeights.value[best] - visible)
            ? candidate
            : best,
    )
}

function onDragStart(event: PointerEvent) {
    if (event.button !== 0) return
    const startY = event.clientY
    const startHeight = visibleHeights.value[snap.value]
    let lastY = startY
    let lastTime = event.timeStamp
    let velocity = 0
    dragged = false

    const move = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientY - startY
        if (!dragged && Math.abs(delta) < DRAG_THRESHOLD_PX) return
        dragged = true
        const elapsed = moveEvent.timeStamp - lastTime
        if (elapsed > 0) velocity = (moveEvent.clientY - lastY) / elapsed
        lastY = moveEvent.clientY
        lastTime = moveEvent.timeStamp
        dragHeight.value = Math.max(
            peekHeight.value,
            Math.min(fullHeight.value, startHeight - delta),
        )
    }
    const end = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        if (dragHeight.value !== null)
            snap.value = nearestSnap(dragHeight.value, velocity)
        dragHeight.value = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
}

function onGripClick(event: MouseEvent) {
    if (!dragged) return
    dragged = false
    event.stopPropagation()
    event.preventDefault()
}

let resizeObserver: ResizeObserver | null = null

function observe() {
    resizeObserver?.disconnect()
    const sheet = sheetRef.value
    const container = sheet?.parentElement
    if (!sheet || !container || !gripRef.value) return
    resizeObserver = new ResizeObserver(() => {
        containerHeight.value = container.clientHeight
        peekHeight.value = gripRef.value?.offsetHeight ?? peekHeight.value
    })
    resizeObserver.observe(container)
    resizeObserver.observe(gripRef.value)
}

watch(sheetRef, () => nextTick(observe))
onMounted(observe)
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<style scoped>
.map-sheet {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--ui-bg);
    color: var(--ui-text-highlighted);
}

.map-sheet--side {
    width: 380px;
    flex-shrink: 0;
    border-left: 1px solid var(--ui-border);
}

.map-sheet--side .map-sheet__header {
    border-bottom: 1px solid var(--ui-border);
}

.map-sheet--collapsed {
    width: auto;
}

.map-sheet--collapsed .map-sheet__header {
    border-bottom: 0;
}

.map-sheet--bottom {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.18);
    transition: height 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.map-sheet--dragging {
    transition: none;
}

.map-sheet__grip {
    flex-shrink: 0;
    touch-action: none;
    user-select: none;
    cursor: grab;
}

.map-sheet__handle {
    display: block;
    width: 100%;
    height: 20px;
    border: 0;
    padding: 0;
    background: none;
    cursor: pointer;
}

.map-sheet__handle::before {
    content: '';
    display: block;
    width: 36px;
    height: 4px;
    margin: 8px auto;
    border-radius: 2px;
    background: color-mix(
        in oklab,
        var(--ui-text-highlighted) 30%,
        transparent
    );
}

.map-sheet__handle:focus-visible {
    outline: 2px solid var(--ui-primary);
    outline-offset: -2px;
}

.map-sheet__header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 8px 4px 16px;
}

.map-sheet--side .map-sheet__header {
    padding: 4px 8px;
}

.map-sheet__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
}

@media (prefers-reduced-motion: reduce) {
    .map-sheet--bottom {
        transition: none;
    }
}
</style>
