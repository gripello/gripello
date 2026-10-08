<template>
    <UTooltip v-if="compact" :text="$t('routes.view')">
        <UButton
            class="icon-btn"
            :to="gymPath(`/route?id=${routeId}`)"
            variant="soft"
            color="neutral"
            icon="i-lucide-chevron-right"
            :aria-label="$t('routes.view')"
            data-testid="route-view"
        />
    </UTooltip>
    <UButton
        v-else
        :to="gymPath(`/route?id=${routeId}`)"
        variant="soft"
        color="neutral"
        trailing-icon="i-lucide-chevron-right"
        data-testid="route-view"
    >
        {{ $t('routes.view') }}
    </UButton>
</template>

<script setup lang="ts">
const gymPath = useGymPath()
defineProps<{ routeId: string; compact?: boolean }>()
</script>
