<template>
    <component :is="as" class="rounded-lg bg-default p-4 ring ring-default">
        <LayoutSectionHeader v-if="title" :title="title" :subtitle="subtitle">
            <template v-if="$slots.actions" #actions>
                <slot name="actions" />
            </template>
        </LayoutSectionHeader>
        <div class="flex flex-col gap-3">
            <slot />
        </div>
    </component>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{ title?: string; subtitle?: string; as?: string }>(),
    { title: undefined, subtitle: undefined, as: 'section' },
)
</script>
