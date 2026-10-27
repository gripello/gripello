<template>
    <LayoutDialogShell
        v-model="open"
        max-width="600"
        closable
        sheet-on-mobile
        :title="$t('ratings.climber_reviews')"
        data-testid="route-details-sheet"
    >
        <LayoutLoadingState v-if="isLoading" :count="2" />
        <LayoutLoadError
            v-else-if="status === 'error'"
            @retry="loadRatings()"
        />

        <div v-if="!isLoading && reviews.length">
            <CommentsCard
                v-for="review in reviews"
                :key="review.id"
                :comment="review"
                date-format="relative"
                class="mb-3"
            >
                <template #actions>
                    <UButton
                        class="icon-btn"
                        icon="i-lucide-flag"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="$t('reports.reportAction')"
                        :title="$t('reports.reportAction')"
                        data-testid="comment-card-report"
                        @click="openReport(review.id)"
                    />
                </template>
            </CommentsCard>
        </div>

        <LayoutEmptyState
            v-if="status === 'success' && !reviews.length"
            icon="i-lucide-sparkles"
            :card="false"
            :title="$t('ratings.no_reviews_yet')"
            :hint="$t('ratings.be_the_first')"
        />
    </LayoutDialogShell>

    <ReportsFormDialog
        v-if="reportTarget"
        v-model="reportDialog"
        content-type="rating"
        :content-id="reportTarget"
    />
</template>

<script setup lang="ts">
import { listRouteRatings } from '~/api/ratings'
import type { RatingRecord } from '~/types/models'
import type { CommentCardItem } from '~/components/comments/Card.vue'
import { formatGrade } from '#shared/utils/grades'
import { cacheKeys } from '~/utils/realtimeCache'

const { t } = useI18n()

const props = defineProps<{ routeId: string }>()
const open = defineModel<boolean>({ default: false })

const { isBlocked } = useBlocks()

const {
    data: ratings,
    status,
    execute: loadRatings,
} = useAsyncData(
    cacheKeys.ratingsSheet(props.routeId),
    async () => (await listRouteRatings(props.routeId)).items,
    { server: false, immediate: false, default: () => [] },
)
const isLoading = computed(() => status.value === 'pending')
const reviews = computed(() =>
    ratings.value
        .filter((rating) => !isBlocked(rating.author?.id))
        .map(mapReview),
)

const reportDialog = ref(false)
const reportTarget = ref<string | null>(null)

function openReport(id: string) {
    reportTarget.value = id
    reportDialog.value = true
}

watch(
    open,
    (isOpen) => {
        if (isOpen && status.value !== 'success') void loadRatings()
    },
    { immediate: true },
)

function mapReview(r: RatingRecord): CommentCardItem {
    return {
        id: r.id,
        rating: typeof r.rating === 'number' ? r.rating : null,
        difficultyLabel: formatGrade(r),
        comment: r.comment ?? null,
        created: r.created ?? '',
        userName: r.author?.name || t('comments.anonymous'),
        userAvatar: r.author?.avatar || null,
    }
}
</script>
