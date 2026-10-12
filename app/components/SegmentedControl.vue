<template>
    <UTabs
        v-model="model"
        :items="items"
        :content="false"
        variant="pill"
        :size="size ?? 'sm'"
        :orientation="orientation"
        class="w-auto max-w-full"
        :ui="{
            list:
                orientation === 'vertical'
                    ? 'w-full'
                    : 'w-auto max-w-full overflow-x-auto overflow-y-hidden',
            trigger:
                orientation === 'vertical'
                    ? 'flex-col gap-1 py-2'
                    : 'flex-none',
            label: 'overflow-visible whitespace-nowrap',
        }"
        :data-testid="testId"
    >
        <template #default="{ item }">
            <span
                :data-testid="
                    item.testId ??
                    (testId ? `${testId}-${item.value}` : undefined)
                "
            >
                {{ item.label }}
            </span>
        </template>
    </UTabs>
</template>

<script setup lang="ts" generic="T extends string">
defineProps<{
    items: {
        value: T
        label: string
        badge?: string | number
        icon?: string
        testId?: string
    }[]
    size?: 'xs' | 'sm' | 'md'
    orientation?: 'horizontal' | 'vertical'
    testId?: string
}>()
const model = defineModel<T>({ required: true })
</script>
