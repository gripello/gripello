<template>
    <UIcon
        name="i-lucide-badge-check"
        role="img"
        :aria-label="$t('routes.rated')"
        :title="$t('routes.rated')"
        class="shrink-0 text-amber-500"
        :class="size === 'sm' ? 'size-[14px]' : 'size-4'"
        data-testid="route-rated-marker"
    />
</template>

<script setup lang="ts">
defineProps<{ size?: 'sm' | 'md' }>()
</script>
