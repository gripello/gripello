<script setup lang="ts">
defineProps<{
    title: string
    subtitle?: string
    inlineActions?: boolean
    backTo?: string
    backLabel?: string
}>()
</script>

<template>
    <UButton
        v-if="backTo"
        :to="backTo"
        variant="link"
        color="neutral"
        icon="i-lucide-arrow-left"
        class="mb-2 px-0"
        data-testid="page-back"
    >
        {{ backLabel }}
    </UButton>
    <header
        class="page-header flex justify-between gap-4 mb-4"
        :class="
            inlineActions
                ? 'items-center'
                : 'flex-col sm:flex-row sm:items-center'
        "
    >
        <div>
            <h1 class="page-header__title">{{ title }}</h1>
            <p v-if="subtitle" class="page-header__subtitle mb-0">
                {{ subtitle }}
            </p>
        </div>
        <div
            v-if="$slots.actions"
            class="page-header__actions flex flex-wrap items-center gap-2"
        >
            <slot name="actions" />
        </div>
    </header>
</template>

<style scoped>
@reference "~/assets/css/main.css";

.page-header__title {
    font-size: 1.6rem;
    font-weight: 700;
    letter-spacing: -0.3px;
    color: var(--ui-text-highlighted);
}

.page-header__subtitle {
    font-size: 0.85rem;
    color: color-mix(in oklab, var(--ui-text-highlighted) 50%, transparent);
}

@variant max-sm {
    .page-header__title {
        font-size: 1.35rem;
    }
}
</style>
