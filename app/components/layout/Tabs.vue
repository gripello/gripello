<template>
    <UTabs
        ref="tabs"
        v-model="model"
        :items="items"
        variant="link"
        class="w-full"
        :ui="{
            list: 'overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            trigger:
                'min-w-fit flex-1 flex-col gap-1 px-2 text-xs md:flex-none md:flex-row md:gap-1.5 md:text-sm',
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
const tabs = useTemplateRef<{ $el?: HTMLElement }>('tabs')

async function revealActiveTab() {
    await nextTick()
    tabs.value?.$el
        ?.querySelector?.('[role="tab"][data-state="active"]')
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

watch(model, revealActiveTab)
onMounted(revealActiveTab)
</script>
