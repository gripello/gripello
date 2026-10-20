<template>
    <LayoutPanel
        :title="title"
        :subtitle="subtitle"
        :icon="icon"
        flush
        as="div"
        class="w-full"
        :data-testid="testid"
    >
        <template v-if="$slots.actions" #actions>
            <slot name="actions" />
        </template>
        <div :class="flush ? 'p-0' : 'p-4'">
            <div v-if="loading && flush" class="flex flex-col gap-4 px-4 py-2">
                <div v-for="n in 3" :key="n" class="flex flex-col gap-2">
                    <USkeleton class="h-4 w-3/4" />
                    <USkeleton class="h-3 w-1/2" />
                </div>
            </div>
            <USkeleton v-else-if="loading" class="h-[300px] w-full" />
            <LayoutEmptyState
                v-else-if="empty"
                :icon="emptyIcon"
                :card="false"
                :title="emptyText ?? $t('analytics.emptySection')"
            />
            <slot v-else />
        </div>
    </LayoutPanel>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{
        title: string
        subtitle?: string
        icon: string
        testid?: string
        loading?: boolean
        empty?: boolean
        emptyIcon?: string
        emptyText?: string
        flush?: boolean
    }>(),
    {
        subtitle: undefined,
        testid: undefined,
        emptyIcon: 'i-lucide-chart-column',
        emptyText: undefined,
    },
)
</script>
