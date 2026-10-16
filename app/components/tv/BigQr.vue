<template>
    <div
        v-if="src"
        class="flex shrink-0 flex-col items-center gap-3 rounded-[2rem] bg-white p-6 shadow-lg ring ring-default"
    >
        <img
            :src="src"
            :alt="alt"
            class="size-[min(50vh,34vw)] portrait:size-[min(36vh,64vw)]"
        />
        <span v-if="caption" class="text-xl font-semibold text-black">{{
            caption
        }}</span>
    </div>
</template>

<script setup lang="ts">
defineProps<{ src: string; alt: string; caption?: string }>()
</script>
