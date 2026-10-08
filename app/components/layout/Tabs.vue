<template>
    <UTabs
        v-model="model"
        :items="items"
        variant="link"
        class="w-full"
        :ui="{
            list: 'overflow-x-auto overflow-y-hidden',
            trigger:
                'flex-1 flex-col gap-1 text-xs md:flex-none md:flex-row md:gap-1.5 md:text-sm',
            label: 'overflow-visible whitespace-nowrap',
        }"
    >
        <template v-for="(_, name) in $slots" #[name]="slotProps">
            <slot :name="name" v-bind="slotProps ?? {}" />
        </template>
    </UTabs>
</template>

<script setup lang="ts" generic="T extends string">
import type { TabsItem } from '@nuxt/ui'

type Item = TabsItem & { value: T }

defineProps<{ items: Item[] }>()
defineSlots<Record<string, (props: { item: Item; index: number }) => unknown>>()
const model = defineModel<T>()
</script>
