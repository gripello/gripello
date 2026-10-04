<template>
    <span
        class="inline-flex shrink-0 items-center justify-center rounded-full"
        :class="[
            size === 'lg' ? 'size-11' : 'size-9',
            { 'bg-elevated': !color },
        ]"
        :style="{
            backgroundColor: color || undefined,
            color: readableTextOn(color),
        }"
    >
        <UIcon
            name="i-lucide-shield-user"
            :class="size === 'lg' ? 'size-5' : 'size-[18px]'"
        />
    </span>
</template>

<script setup lang="ts">
import { readableTextOn } from '~/utils/color'

defineProps<{ color?: string | null; size?: 'md' | 'lg' }>()
</script>
