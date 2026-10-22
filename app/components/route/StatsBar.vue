<template>
    <div
        class="flex items-center justify-around py-4 max-sm:[&_.stat-tile-icon]:hidden lg:justify-start lg:gap-8"
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
        <template v-if="removalDate">
            <USeparator orientation="vertical" class="my-1 h-10" />
            <LayoutStatTile
                :label="t('routes.outShort')"
                :value="removalDate"
                icon="i-lucide-calendar-clock"
                color="warning"
                icon-color="warning"
                data-testid="route-out-soon"
            />
        </template>
        <template v-if="anchorPoint">
            <USeparator orientation="vertical" class="my-1 h-10" />
            <LayoutStatTile
                :label="t('climbing.anchor_point')"
                :value="anchorPoint"
                icon="i-lucide-hash"
                data-testid="route-anchor-point"
            />
        </template>
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
    anchorPoint?: number | null
    removalPlannedFor?: string | null
}>()

const { t, locale } = useI18n()

const ratedCount = computed(
    () => props.reviews.filter((review) => (review.rating ?? 0) > 0).length,
)
const shortDate = (date: string | null | undefined) =>
    formatDate(date, { locale: locale.value, day: 'numeric', month: 'numeric' })
const screwDate = computed(() => shortDate(props.screwDate))
const removalDate = computed(() => shortDate(props.removalPlannedFor))
</script>
