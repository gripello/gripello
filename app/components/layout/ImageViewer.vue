<script setup lang="ts">
defineProps<{ src: string; alt: string }>()

const open = ref(false)
</script>

<template>
    <button
        type="button"
        class="cursor-zoom-in"
        :aria-label="alt"
        v-bind="$attrs"
        @click="open = true"
    >
        <slot />
    </button>
    <LayoutDialogShell
        v-model="open"
        :title="alt"
        closable
        flush
        :scrollable="false"
        max-width="960"
    >
        <LayoutZoomableImage :src="src" :alt="alt" />
    </LayoutDialogShell>
</template>
