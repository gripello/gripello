<template>
    <ul
        class="divide-y divide-default"
        :class="
            !flush && 'overflow-hidden rounded-lg bg-default ring ring-default'
        "
    >
        <slot />
    </ul>
</template>

<script setup lang="ts">
defineProps<{ flush?: boolean }>()
</script>
