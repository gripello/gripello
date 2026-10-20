<template>
    <div
        class="list-card comment-card rounded-lg bg-default ring ring-default"
        :id="`comment-${comment.id}`"
        :data-testid="`comment-card-${comment.id}`"
    >
        <div class="comment-card__body">
            <UCheckbox
                v-if="selectable"
                :model-value="selected"
                class="list-card__checkbox comment-card__lead"
                :aria-label="
                    $t('common.selectItem', { name: comment.userName })
                "
                data-testid="comment-card-checkbox"
                @update:model-value="$emit('toggle-select')"
            />
            <ClimberAvatar
                :src="comment.userAvatar"
                :name="comment.userName"
                size="sm"
                class="comment-card__lead"
            />

            <div class="comment-card__main">
                <div class="comment-card__head">
                    <div class="list-card__title">
                        <NuxtLink
                            v-if="comment.userId"
                            :to="`/climber?id=${comment.userId}`"
                            class="list-card__name hover:underline"
                            data-testid="comment-card-author"
                            >{{ comment.userName }}</NuxtLink
                        >
                        <span
                            v-else
                            class="list-card__name"
                            data-testid="comment-card-author"
                            >{{ comment.userName }}</span
                        >
                        <span
                            class="comment-card__date flex flex-wrap items-center gap-x-1.5 gap-y-1"
                            data-testid="comment-card-meta"
                        >
                            {{ formattedDate }}
                            <UTooltip
                                v-if="comment.difficultyLabel"
                                :text="t('ratings.perceived_difficulty')"
                            >
                                <span
                                    class="list-card__pill"
                                    data-testid="comment-card-perceived"
                                >
                                    <UIcon
                                        :name="PERCEIVED_GRADE_ICON"
                                        class="size-[13px]"
                                    />
                                    {{ t('ratings.perceived') }}
                                    {{ comment.difficultyLabel }}
                                </span>
                            </UTooltip>
                        </span>
                    </div>

                    <div
                        v-if="comment.rating"
                        class="comment-card__aside flex shrink-0 comment-card__rating"
                        role="img"
                        :aria-label="`${comment.rating}/5`"
                    >
                        <UIcon
                            v-for="star in 5"
                            :key="star"
                            name="i-lucide-star"
                            mode="svg"
                            class="size-[18px]"
                            :class="
                                star <= comment.rating
                                    ? 'text-amber-500 **:fill-current'
                                    : 'text-dimmed'
                            "
                        />
                    </div>
                    <div
                        v-if="actionsInHeader && $slots.actions"
                        class="comment-card__actions -me-2 flex shrink-0 items-center"
                    >
                        <slot name="actions" />
                    </div>
                </div>

                <div v-if="comment.comment" class="comment-card__text">
                    <span
                        ref="commentEl"
                        class="comment-card__comment"
                        data-testid="comment-card-comment"
                        :class="{
                            'comment-card__comment--collapsed':
                                collapsible && !expanded,
                        }"
                        >{{ comment.comment }}</span
                    >
                    <div v-if="collapsible && isLong" class="mt-1">
                        <UButton
                            variant="link"
                            size="xs"
                            :color="expanded ? 'neutral' : 'primary'"
                            class="px-0"
                            data-testid="comment-card-toggle"
                            @click="expanded = !expanded"
                        >
                            {{
                                expanded
                                    ? t('comments.showLess')
                                    : t('comments.showMore')
                            }}
                        </UButton>
                    </div>
                </div>

                <div
                    v-if="(showRoute && comment.routeName) || comment.location"
                    class="list-card__pills"
                >
                    <template v-if="showRoute && comment.routeName">
                        <NuxtLink
                            v-if="comment.routeId"
                            :to="gymPath(`/route?id=${comment.routeId}`)"
                            class="list-card__pill comment-card__route-link font-medium text-primary no-underline"
                        >
                            <UIcon name="i-lucide-route" class="size-[13px]" />
                            {{ comment.routeName }}
                        </NuxtLink>
                        <span v-else class="list-card__pill font-medium">
                            <UIcon name="i-lucide-route" class="size-[13px]" />
                            {{ comment.routeName }}
                        </span>
                    </template>
                    <span v-if="comment.location" class="list-card__pill">
                        <UIcon name="i-lucide-map-pin" class="size-[13px]" />
                        {{ comment.location }}
                    </span>
                </div>
            </div>
        </div>

        <div
            v-if="!actionsInHeader && $slots.actions"
            class="list-card__actions flex items-center justify-end gap-1"
        >
            <slot name="actions" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { PERCEIVED_GRADE_ICON } from '~/utils/routeReviews'
import { formatDate, timeAgo as sharedTimeAgo } from '#shared/utils/formatting'

const gymPath = useGymPath()

export interface CommentCardItem {
    id: string
    userName: string
    userAvatar?: string | null
    userId?: string
    rating?: number | null
    created: string
    comment?: string | null
    difficultyLabel?: string | null
    routeName?: string | null
    routeId?: string | null
    location?: string | null
}

const props = withDefaults(
    defineProps<{
        comment: CommentCardItem
        selectable?: boolean
        selected?: boolean
        showRoute?: boolean
        dateFormat?: 'relative' | 'absolute'
        collapsible?: boolean
        actionsInHeader?: boolean
    }>(),
    {
        selectable: false,
        selected: false,
        showRoute: false,
        dateFormat: 'absolute',
        collapsible: true,
    },
)

defineEmits<{
    (e: 'toggle-select'): void
}>()

const { t, locale } = useI18n()

// ── Collapse ────────────────────────────────────────────────────────────────

const expanded = ref(false)
const commentEl = ref<HTMLElement | null>(null)
const isLong = ref(false)

function measureClamp() {
    const el = commentEl.value
    if (el) isLong.value = el.scrollHeight > el.clientHeight + 1
}

onMounted(async () => {
    await nextTick()
    measureClamp()
    document.fonts?.ready.then(measureClamp)
})

watch(
    () => props.comment.comment,
    () => nextTick(measureClamp),
)

// ── Date ────────────────────────────────────────────────────────────────────

const formattedDate = computed(() => {
    const d = props.comment.created
    if (!d) return '—'
    if (props.dateFormat === 'relative') return timeAgo(d)
    return formatDate(d, {
        locale: locale.value,
        fallback: '—',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })
})

function timeAgo(dateStr: string): string {
    return sharedTimeAgo(dateStr, t, locale.value)
}
</script>

<style scoped>
.comment-card__body {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
}

.comment-card__lead {
    flex-shrink: 0;
}

.comment-card__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.comment-card__head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.comment-card__aside {
    height: 1.3rem;
    align-items: center;
}

.comment-card__actions {
    margin-top: -11px;
}

.comment-card__date {
    font-size: 0.75rem;
    color: var(--ui-text-muted);
    line-height: 1.2;
}

.comment-card__comment {
    font-size: 0.875rem;
    color: var(--ui-text-toned);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
}

.comment-card__comment--collapsed {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.comment-card__route-link:hover {
    text-decoration: underline;
}
</style>
