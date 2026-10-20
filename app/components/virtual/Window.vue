<template>
    <div
        ref="el"
        :class="{ 'lazy-render__placeholder': !rendered }"
        :style="rendered ? undefined : { height: `${placeholderHeight}px` }"
    >
        <slot v-if="rendered" />
    </div>
</template>

<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        estimatedHeight?: number
        mountMargin?: string
        unmountMargin?: string
    }>(),
    {
        estimatedHeight: 240,
        mountMargin: '200px 0px',
        unmountMargin: '800px 0px',
    },
)

const el = ref<HTMLElement | null>(null)
const rendered = ref(false)
const placeholderHeight = ref(props.estimatedHeight)

let nearObserver: IntersectionObserver | null = null
let farObserver: IntersectionObserver | null = null

onMounted(() => {
    if (typeof IntersectionObserver === 'undefined' || !el.value) {
        rendered.value = true
        return
    }

    nearObserver = new IntersectionObserver(
        (entries) => {
            if (entries.at(-1)?.isIntersecting) {
                rendered.value = true
            }
        },
        { rootMargin: props.mountMargin },
    )
    nearObserver.observe(el.value)

    farObserver = new IntersectionObserver(
        (entries) => {
            if (!entries.at(-1)?.isIntersecting) {
                if (rendered.value && el.value) {
                    const h = el.value.offsetHeight
                    if (h > 0) placeholderHeight.value = h
                }
                rendered.value = false
            }
        },
        { rootMargin: props.unmountMargin },
    )
    farObserver.observe(el.value)
})

onBeforeUnmount(() => {
    nearObserver?.disconnect()
    nearObserver = null
    farObserver?.disconnect()
    farObserver = null
})
</script>

<style scoped>
.lazy-render__placeholder {
    border-radius: 4px;
    background: color-mix(in oklab, var(--ui-text-highlighted) 4%, transparent);
}
</style>
