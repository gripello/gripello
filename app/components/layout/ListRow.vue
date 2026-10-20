<template>
    <li>
        <NuxtLink
            v-if="to"
            :to="to"
            :class="[rowClass, 'transition-colors hover:bg-elevated/60']"
        >
            <span v-if="icon" :class="iconClass">
                <UIcon :name="icon" class="size-4" />
            </span>
            <slot />
        </NuxtLink>
        <component :is="as" v-else :class="rowClass">
            <span v-if="icon" :class="iconClass">
                <UIcon :name="icon" class="size-4" />
            </span>
            <slot />
        </component>
    </li>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

const props = withDefaults(
    defineProps<{
        to?: RouteLocationRaw
        dense?: boolean
        wrap?: boolean
        as?: 'div' | 'label'
        icon?: string
        iconActive?: boolean
    }>(),
    { to: undefined, as: 'div', icon: undefined },
)

const rowClass = computed(() => [
    'flex items-center gap-3',
    props.dense ? 'min-h-13 py-1 ps-4 pe-1' : 'px-4 py-3',
    props.wrap && 'flex-wrap',
    props.as === 'label' && 'cursor-pointer',
])

const iconClass = computed(() => [
    'inline-flex size-9 shrink-0 items-center justify-center rounded-lg',
    props.iconActive ? 'bg-primary/10 text-primary' : 'bg-elevated text-muted',
])
</script>
