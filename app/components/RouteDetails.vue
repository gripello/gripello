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

        <LayoutDialogShell
            v-model="isSheetOpen"
            max-width="600"
            closable
            sheet-on-mobile
            :title="$t('ratings.climber_reviews')"
            data-testid="route-details-sheet"
        >
            <LayoutLoadingState v-if="isLoading" :count="2" />

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
                v-if="!isLoading && !reviews.length"
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
            :content-url="reportUrl"
        />
    </div>
</template>

<script setup lang="ts">
import type PocketBase from 'pocketbase'
import type { RatingRecord } from '~/types/models'
import type { CommentCardItem } from '~/components/comments/Card.vue'
import { formatGrade } from '#shared/utils/grades'
import { reportContentUrl } from '~/utils/reports'
import { cacheKeys } from '~/utils/realtimeCache'

const { t } = useI18n()

const props = defineProps<{
    route_id: string
    compact?: boolean
}>()

const pb = usePocketbase() as PocketBase
const { error: notifyError } = useNotification()

const isSheetOpen = ref(false)

const {
    data: ratings,
    status,
    execute: loadRatings,
} = useAsyncData(
    cacheKeys.ratingsSheet(props.route_id),
    async () => {
        try {
            return await pb.collection('ratings').getFullList<RatingRecord>({
                filter: pb.filter('route_id = {:id}', { id: props.route_id }),
                sort: '-created',
                requestKey: null,
            })
        } catch (error) {
            console.error('Error fetching ratings:', error)
            notifyError(t('ratings.loadError'))
            return []
        }
    },
    { server: false, immediate: false, default: () => [] },
)
const isLoading = computed(() => status.value === 'pending')
const reviews = computed(() => ratings.value.map(mapReview))

const reportDialog = ref(false)
const reportTarget = ref<string | null>(null)
const reportUrl = computed(() =>
    reportTarget.value
        ? reportContentUrl('rating', reportTarget.value, props.route_id)
        : '',
)

function openReport(id: string) {
    reportTarget.value = id
    reportDialog.value = true
}

function openSheet() {
    isSheetOpen.value = true
    if (props.route_id && status.value !== 'success') void loadRatings()
}

function mapReview(
    r: RatingRecord & { expand?: Record<string, unknown> },
): CommentCardItem {
    const user = r.expand?.user as
        { name?: string; username?: string; avatar?: string } | undefined

    return {
        id: r.id,
        rating: typeof r.rating === 'number' ? r.rating : null,
        difficultyLabel: formatGrade(r),
        comment: r.comment ?? null,
        created: r.created ?? '',
        userName: user?.name || user?.username || t('comments.anonymous'),
        userAvatar: r.expand?.user
            ? usePbFileUrl(r.expand.user, user?.avatar, { thumb: '80x80' }) ||
              null
            : null,
    }
}
</script>
