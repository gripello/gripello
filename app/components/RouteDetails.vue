<template>
    <div class="view-ratings-wrapper">
        <UButton
            class="icon-btn"
            v-if="compact"
            icon="i-lucide-star"
            color="neutral"
            variant="ghost"
            :aria-label="$t('ratings.ratings')"
            :title="$t('ratings.ratings')"
            data-testid="route-details-open"
            @click="openSheet"
        />
        <UButton
            v-else
            color="primary"
            data-testid="route-details-open"
            @click="openSheet"
        >
            {{ $t('ratings.ratings') }}
        </UButton>

        <RouteReviewsDialog
            v-if="opened"
            v-model="isSheetOpen"
            :route-id="route_id"
        />
    </div>
</template>

<script setup lang="ts">
defineProps<{
    route_id: string
    compact?: boolean
}>()

const isSheetOpen = ref(false)
const opened = ref(false)

function openSheet() {
    opened.value = true
    isSheetOpen.value = true
}
</script>
