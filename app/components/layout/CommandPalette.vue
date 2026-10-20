<template>
    <UButton
        class="icon-btn"
        icon="i-lucide-search"
        color="neutral"
        variant="ghost"
        size="xl"
        data-testid="command-palette-open"
        :aria-label="`${$t('nav.commandPalette')} (${getKbdKey('meta')}+K)`"
        @click="open = true"
    />

    <LazyLayoutCommandPaletteDialog
        v-if="loaded"
        v-model:open="open"
        :pages="pages"
    />
</template>

<script setup lang="ts">
defineProps<{
    pages: { to: string; icon: string; label: string }[]
}>()

const { getKbdKey } = useKbd()
const open = ref(false)
const loaded = ref(false)
watch(open, (value) => {
    if (value) loaded.value = true
})

defineShortcuts({
    meta_k: {
        usingInput: true,
        handler: () => (open.value = !open.value),
    },
})
</script>
