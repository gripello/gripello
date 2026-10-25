<template>
    <UTabs
        ref="tabs"
        v-model="model"
        :items="items"
        variant="link"
        class="w-full"
        :ui="stacked ? STACKED_UI : fill ? FILL_UI : DEFAULT_UI"
    >
        <template v-if="stacked" #leading="{ item }">
            <span class="relative inline-flex shrink-0" data-tab-icon>
                <UIcon
                    v-if="item.icon"
                    :name="item.icon"
                    class="size-5"
                    aria-hidden="true"
                />
                <span
                    v-if="countOf(item)"
                    aria-hidden="true"
                    class="absolute -top-1.5 -right-2.5 h-4 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-inverted tabular-nums"
                    :data-testid="badgeTestId(item)"
                >
                    {{ countOf(item) }}
                </span>
            </span>
        </template>
        <template v-if="stacked" #default="{ item, index }">
            <template v-if="countOf(item)">
                <span aria-hidden="true">
                    <slot :item="item" :index="index">{{ item.label }}</slot>
                </span>
                <span class="sr-only">{{
                    `${item.label}, ${countOf(item)}`
                }}</span>
            </template>
            <slot v-else :item="item" :index="index">{{ item.label }}</slot>
        </template>
        <template v-if="stacked" #trailing>
            <span class="hidden" />
        </template>
        <template v-for="name in passThroughSlots()" #[name]="slotProps">
            <slot :name="name" v-bind="slotProps ?? {}" />
        </template>
    </UTabs>
</template>

<script setup lang="ts" generic="T extends string">
import type { TabsItem } from '@nuxt/ui'

type Item = TabsItem & { value: T }

const props = defineProps<{
    items: Item[]
    stacked?: boolean
    fill?: boolean
}>()
const slots =
    defineSlots<
        Record<string, (props: { item: Item; index: number }) => unknown>
    >()
const model = defineModel<T>()
const tabs = useTemplateRef<{ $el?: HTMLElement }>('tabs')

const SCROLLING_LIST =
    'overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
const DEFAULT_UI = {
    list: SCROLLING_LIST,
    indicator: 'h-0.5',
    trigger:
        'min-w-fit flex-1 flex-col gap-1 px-2 text-xs md:flex-none md:flex-row md:gap-1.5 md:text-sm',
    label: 'overflow-visible whitespace-nowrap',
}
const FILL_UI = {
    ...DEFAULT_UI,
    trigger:
        'min-w-fit flex-1 justify-center gap-1.5 px-2 py-2.5 text-sm font-medium',
}
const STACKED_UI = {
    list: SCROLLING_LIST,
    indicator: 'h-0.5',
    trigger:
        'min-w-0 flex-1 basis-0 flex-col gap-1 px-1 py-2 text-[11px] md:flex-none md:basis-auto md:flex-row md:gap-2.5 md:px-3 md:text-sm',
    label: 'max-w-full truncate',
}

function passThroughSlots() {
    return Object.keys(slots).filter(
        (name) =>
            !props.stacked ||
            !['default', 'leading', 'trailing'].includes(name),
    )
}

function countOf(item: TabsItem) {
    const badge = item.badge
    const count =
        typeof badge === 'object' && badge !== null ? badge.label : badge
    return count && count !== '0' ? count : undefined
}

function badgeTestId(item: TabsItem) {
    const badge = item.badge as Record<string, unknown> | undefined
    return typeof badge === 'object' ? badge['data-testid'] : undefined
}

async function revealActiveTab() {
    await nextTick()
    tabs.value?.$el
        ?.querySelector?.('[role="tab"][data-state="active"]')
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

watch(model, revealActiveTab)
onMounted(revealActiveTab)
</script>
