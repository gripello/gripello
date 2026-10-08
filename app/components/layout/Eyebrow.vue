<template>
    <component
        :is="as"
        class="mb-2 px-1 text-xs font-semibold tracking-wide text-muted uppercase"
    >
        <slot />
    </component>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ as?: string }>(), { as: 'h3' })
</script>
