<template>
    <UTabs
        v-model="model"
        :items="items"
        :content="false"
        variant="pill"
        :size="size ?? 'xs'"
        class="w-auto"
        :ui="{ list: 'w-auto', trigger: 'flex-none' }"
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
    items: { value: T; label: string }[]
    size?: 'xs' | 'sm' | 'md'
    testId?: string
}>()
const model = defineModel<T>({ required: true })
</script>
