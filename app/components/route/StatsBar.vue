<template>
    <div
        class="flex items-center justify-around py-4 lg:justify-start lg:gap-8"
    >
        <LayoutStatTile
            :label="t('ratings.ratingCount', { n: ratedCount }, ratedCount)"
            :value="formatNumber(averageRating(reviews), locale)"
            icon="i-lucide-star"
            icon-color="warning"
            data-testid="route-avg-rating"
        />
        <USeparator orientation="vertical" class="my-1 h-10" />
        <LayoutStatTile
            :label="t('routes.sends')"
            :value="sendsCount ?? '—'"
            data-testid="route-sends"
        />
        <USeparator orientation="vertical" class="my-1 h-10" />
        <LayoutStatTile
            :label="t('routes.screwedShort')"
            :value="screwDate || '—'"
            icon="i-lucide-calendar"
            data-testid="route-screw-date"
        />
    </div>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import { formatNumber } from '#shared/utils/number'
import { averageRating, type ReviewDisplay } from '~/utils/routeReviews'

const props = defineProps<{
    reviews: ReviewDisplay[]
    sendsCount?: number
    screwDate?: string | null
}>()

const { t, locale } = useI18n()

const ratedCount = computed(
    () => props.reviews.filter((review) => (review.rating ?? 0) > 0).length,
)
const screwDate = computed(() =>
    formatDate(props.screwDate, {
        locale: locale.value,
        day: 'numeric',
        month: 'numeric',
    }),
)
</script>
