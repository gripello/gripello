<script setup lang="ts">
import type { GymOpeningHours } from '#shared/utils/openingHours'

const props = defineProps<{ hours?: GymOpeningHours | null }>()
const { status, label } = useOpenStatus(() => props.hours)
</script>

<template>
    <UBadge
        v-if="status"
        :color="status.open ? 'success' : 'neutral'"
        variant="soft"
        size="sm"
        :label="label"
        data-testid="gym-open-badge"
    />
</template>
