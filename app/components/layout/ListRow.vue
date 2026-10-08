<template>
    <li>
        <NuxtLink
            v-if="to"
            :to="to"
            class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/60"
        >
            <slot />
        </NuxtLink>
        <div v-else class="flex items-center gap-3 px-4 py-3">
            <slot />
        </div>
    </li>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

defineProps<{ to?: RouteLocationRaw }>()
</script>
