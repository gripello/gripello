<script setup lang="ts">
defineProps<{
    title?: string
    subtitle?: string
    icon?: string
}>()
</script>

<template>
    <header
        class="section-header mb-4 flex flex-wrap items-center justify-between gap-3"
    >
        <div class="flex min-w-0 items-center gap-2.5">
            <span
                v-if="icon"
                class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
            >
                <UIcon :name="icon" class="size-4" />
            </span>
            <div class="min-w-0">
                <h2 class="section-header__title">
                    <slot name="title">{{ title }}</slot>
                </h2>
                <div
                    v-if="subtitle || $slots.subtitle"
                    class="section-header__subtitle"
                >
                    <slot name="subtitle">{{ subtitle }}</slot>
                </div>
            </div>
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
    color: var(--ui-text-muted);
}
</style>
