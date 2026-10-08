<template>
    <UTabs
        v-model="model"
        :items="items"
        :content="false"
        variant="pill"
        :size="size ?? 'sm'"
        class="w-auto max-w-full"
        :ui="{
            list: 'w-auto max-w-full overflow-x-auto overflow-y-hidden',
            trigger: 'flex-none',
            label: 'overflow-visible whitespace-nowrap',
        }"
        :data-testid="testId"
    >
        <template #default="{ item }">
            <span :data-testid="testId ? `${testId}-${item.value}` : undefined">
                {{ item.label }}
            </span>
        </template>
    </UTabs>
</template>

<script setup lang="ts" generic="T extends string">
defineProps<{
    items: { value: T; label: string; badge?: string | number }[]
    size?: 'xs' | 'sm' | 'md'
    testId?: string
}>()
const model = defineModel<T>({ required: true })
</script>
