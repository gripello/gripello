<template>
    <section class="@container">
        <div class="mb-3 flex items-center gap-2">
            <h2 class="text-base font-bold">
                {{ t('ratings.climber_reviews') }}
            </h2>
            <UBadge
                v-if="reviews.length"
                variant="soft"
                color="primary"
                class="rounded-full"
            >
                {{ reviews.length }}
            </UBadge>
        </div>

        <div
            v-if="reviews.length"
            class="grid items-start gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3"
        >
            <CommentsCard
                v-for="review in reviews"
                :key="review.id"
                :comment="review"
                date-format="relative"
                actions-in-header
                :class="{
                    'comment-card--target': review.id === targetCommentId,
                }"
            >
                <template #actions>
                    <UButton
                        v-if="!review.mine"
                        icon="i-lucide-flag"
                        color="neutral"
                        variant="ghost"
                        class="icon-btn"
                        :aria-label="t('reports.reportAction')"
                        :title="t('reports.reportAction')"
                        data-testid="comment-card-report"
                        @click="openReport(review.id)"
                    />
                    <UButton
                        v-else
                        icon="i-lucide-trash-2"
                        color="neutral"
                        variant="ghost"
                        class="icon-btn"
                        :aria-label="t('ratings.deleteOwn')"
                        :title="t('ratings.deleteOwn')"
                        data-testid="comment-card-delete"
                        @click="deleteTarget = review.id"
                    />
                </template>
            </CommentsCard>
        </div>

        <LayoutEmptyState
            v-else
            icon="i-lucide-sparkles"
            :title="t('ratings.no_reviews_yet')"
            :hint="t('ratings.be_the_first')"
        />

        <ConfirmDialog
            :model-value="!!deleteTarget"
            :title="t('ratings.deleteOwn')"
            :message="t('ratings.deleteOwnConfirm')"
            :confirm-text="t('actions.delete')"
            @update:model-value="deleteTarget = null"
            @confirm="deleteOwnReview"
        />

        <ReportsFormDialog
            v-if="reportTarget"
            v-model="reportDialog"
            content-type="rating"
            :content-id="reportTarget"
        />
    </section>
</template>

<script setup lang="ts">
import { deleteRating } from '~/api/ratings'
import type { ReviewDisplay } from '~/utils/routeReviews'

defineProps<{
    reviews: ReviewDisplay[]
    targetCommentId: string
}>()
const emit = defineEmits<{ deleted: [id: string] }>()

const { t } = useI18n()
const { error: notifyError } = useNotification()

const reportDialog = ref(false)
const reportTarget = ref<string | null>(null)

function openReport(id: string) {
    reportTarget.value = id
    reportDialog.value = true
}

const deleteTarget = ref<string | null>(null)
async function deleteOwnReview() {
    const id = deleteTarget.value
    deleteTarget.value = null
    if (!id) return
    try {
        await deleteRating(id)
        emit('deleted', id)
    } catch (error) {
        console.error(error)
        notifyError(t('notifications.error.generic'))
    }
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.comment-card--target {
    outline: 2px solid var(--ui-success);
    outline-offset: 2px;
    animation: target-fade 3s ease-out forwards;
}

@keyframes target-fade {
    0%,
    60% {
        outline-color: var(--ui-success);
    }
    100% {
        outline-color: color-mix(in oklab, var(--ui-success) 0%, transparent);
    }
}

@media (prefers-reduced-motion: reduce) {
    .comment-card--target {
        animation: none;
    }
}
</style>
