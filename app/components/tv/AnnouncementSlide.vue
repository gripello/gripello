<template>
    <div
        class="flex min-h-0 flex-1 flex-col items-center justify-center gap-10 px-[6vw] text-center"
        data-testid="tv-announcement"
    >
        <UIcon name="i-lucide-megaphone" class="size-24 text-primary" />
        <p
            class="text-7xl leading-tight font-black tracking-tight break-words text-highlighted"
        >
            {{ text }}
        </p>
    </div>
</template>

<script setup lang="ts">
defineProps<{ text: string }>()
</script>
