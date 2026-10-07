<template>
    <div class="group/strip relative" @mouseenter="measure">
        <div
            ref="scroller"
            class="scroll-strip flex snap-x items-start gap-3 overflow-x-auto p-1"
            v-bind="$attrs"
            @scroll.passive="measure"
        >
            <slot />
        </div>
        <UButton
            v-for="side in visibleSides"
            :key="side"
            :icon="
                side === 'start'
                    ? 'i-lucide-chevron-left'
                    : 'i-lucide-chevron-right'
            "
            color="neutral"
            variant="solid"
            class="icon-btn absolute top-1/2 hidden -translate-y-1/2 rounded-full shadow-lg md:flex"
            :class="side === 'start' ? '-start-3' : '-end-3'"
            :aria-label="
                side === 'start' ? t('actions.previous') : t('actions.next')
            "
            @click="scrollBy(side === 'start' ? -1 : 1)"
        />
    </div>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const { t } = useI18n()
const scroller = useTemplateRef<HTMLDivElement>('scroller')
const canStart = ref(false)
const canEnd = ref(false)
const visibleSides = computed(() =>
    (['start', 'end'] as const).filter((side) =>
        side === 'start' ? canStart.value : canEnd.value,
    ),
)

function measure() {
    const element = scroller.value
    if (!element) return
    canStart.value = element.scrollLeft > 4
    canEnd.value =
        element.scrollLeft + element.clientWidth < element.scrollWidth - 4
}

function scrollBy(direction: -1 | 1) {
    scroller.value?.scrollBy({
        left: direction * scroller.value.clientWidth * 0.8,
        behavior: 'smooth',
    })
}

let observer: ResizeObserver | undefined
onMounted(() => {
    measure()
    observer = new ResizeObserver(measure)
    if (scroller.value) observer.observe(scroller.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<style scoped>
.scroll-strip {
    scrollbar-width: none;
}

.scroll-strip::-webkit-scrollbar {
    display: none;
}
</style>
