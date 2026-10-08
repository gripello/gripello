<script setup lang="ts">
defineProps<{
    name: unknown
    ratings?: Array<{
        rating?: unknown
        comment?: unknown
        grade?: unknown
        difficulty?: unknown
    }>
}>()
</script>

<template>
    <LayoutPanel
        v-if="ratings?.length"
        :title="$t('importRoutes.ratingsFor', { name })"
        class="my-4"
    >
        <ul class="flex flex-col gap-3">
            <li v-for="(rating, i) in ratings" :key="i">
                <div class="text-sm">
                    <strong>{{ $t('importRoutes.ratingLabel') }}:</strong>
                    {{ rating.rating }}/5,
                    <strong>{{ $t('importRoutes.difficultyLabel') }}:</strong>
                    {{ rating.grade ?? rating.difficulty }}
                </div>
                <div class="text-sm text-muted">
                    {{ rating.comment || $t('importRoutes.noComment') }}
                </div>
            </li>
        </ul>
    </LayoutPanel>
    <LayoutEmptyState
        v-else
        :card="false"
        icon="i-lucide-message-square-off"
        :title="$t('importRoutes.noRatings')"
    />
</template>
