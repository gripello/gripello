<template>
    <component
        :is="as"
        class="flex flex-col rounded-lg bg-default ring ring-default"
        :class="flush ? 'overflow-hidden' : padding === 'sm' ? 'p-3' : 'p-4'"
    >
        <LayoutSectionHeader
            v-if="title || $slots.title"
            :title="title"
            :subtitle="subtitle"
            :icon="icon"
            :class="
                flush &&
                (padding === 'sm' ? 'mb-0! px-3 py-2' : 'mb-0! px-4 py-3')
            "
        >
            <template v-if="$slots.title" #title>
                <slot name="title" />
            </template>
            <template v-if="$slots.subtitle" #subtitle>
                <slot name="subtitle" />
            </template>
            <template v-if="$slots.actions" #actions>
                <slot name="actions" />
            </template>
        </LayoutSectionHeader>
        <USeparator v-if="flush && (title || $slots.title)" />
        <div class="flex flex-1 flex-col" :class="flush ? '' : 'gap-3'">
            <slot />
        </div>
    </component>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{
        title?: string
        subtitle?: string
        icon?: string
        flush?: boolean
        padding?: 'sm' | 'md'
        as?: string
    }>(),
    {
        title: undefined,
        subtitle: undefined,
        icon: undefined,
        padding: 'md',
        as: 'section',
    },
)
</script>
