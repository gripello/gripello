<template>
    <span class="line-clamp-2 text-sm" :title="names">{{ names }}</span>
</template>

<script setup lang="ts">
const props = defineProps<{ creators: string[] }>()
const names = computed(() => props.creators.join(', '))
</script>
