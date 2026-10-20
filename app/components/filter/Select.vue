<template>
    <USelectMenu
        v-bind="$attrs"
        :search-input="false"
        class="w-full sm:w-auto sm:min-w-44"
        :ui="{
            base: 'ps-0',
            leading: 'static shrink-0 ps-3 pe-2',
            value: 'font-medium text-highlighted',
        }"
    >
        <template #leading>
            <span class="text-muted">{{ label }}</span>
        </template>
    </USelectMenu>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })
defineProps<{ label: string }>()
</script>
