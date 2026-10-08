<script setup lang="ts">
defineProps<{
    title: string
    subtitle?: string
}>()
</script>

<template>
    <header
        class="section-header flex flex-wrap items-center justify-between gap-3 mb-4"
    >
        <div class="min-w-0">
            <h2 class="section-header__title">{{ title }}</h2>
            <p v-if="subtitle" class="section-header__subtitle mb-0">
                {{ subtitle }}
            </p>
        </div>
        <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
            <slot name="actions" />
        </div>
    </header>
</template>

<style scoped>
.section-header__title {
    font-size: 1.15rem;
    font-weight: 600;
    letter-spacing: -0.2px;
    color: var(--ui-text-highlighted);
}

.section-header__subtitle {
    font-size: 0.85rem;
    color: color-mix(in oklab, var(--ui-text-highlighted) 50%, transparent);
}
</style>
