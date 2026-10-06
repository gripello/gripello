<template>
    <div
        class="list-card comment-card rounded-lg bg-elevated"
        :id="`comment-${comment.id}`"
        :data-testid="`comment-card-${comment.id}`"
    >
        <div class="list-card__header">
            <UCheckbox
                v-if="selectable"
                :model-value="selected"
                class="list-card__checkbox"
                :aria-label="
                    $t('common.selectItem', { name: comment.userName })
                "
                data-testid="comment-card-checkbox"
                @update:model-value="$emit('toggle-select')"
            />
            <img
                v-if="comment.userAvatar"
                :src="comment.userAvatar"
                :alt="comment.userName"
                class="size-8 shrink-0 rounded-full object-cover"
            />
            <span
                v-else
                class="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                :style="{ backgroundColor: avatarColor(comment.userName) }"
            >
                {{ nameInitials(comment.userName) }}
            </span>

            <div class="list-card__title">
                <NuxtLink
                    v-if="comment.userId"
                    :to="`/climber?id=${comment.userId}`"
                    class="list-card__name hover:underline"
                    data-testid="comment-card-author"
                    >{{ comment.userName }}</NuxtLink
                >
                <span v-else class="list-card__name">{{
                    comment.userName
                }}</span>
                <span class="comment-card__date">{{ formattedDate }}</span>
            </div>

            <div
                v-if="comment.rating"
                class="flex shrink-0 comment-card__rating"
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
                class="-me-2 flex shrink-0 items-center"
            >
                <slot name="actions" />
            </div>
        </div>

        <USeparator />

        <div class="list-card__meta">
            <div
                v-if="comment.comment"
                class="list-card__meta-row list-card__meta-row--full"
            >
                <UIcon
                    name="i-lucide-message-square-text"
                    class="list-card__meta-icon size-[15px]"
                />
                <div class="comment-card__comment-wrap">
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
            </div>

            <div
                v-if="showRoute && comment.routeName"
                class="list-card__meta-row list-card__meta-row--full"
            >
                <UIcon
                    name="i-lucide-route"
                    class="list-card__meta-icon size-[15px]"
                />
                <NuxtLink
                    v-if="comment.routeId"
                    :to="gymPath(`/route?id=${comment.routeId}`)"
                    class="comment-card__route-link text-sm font-medium text-primary no-underline"
                >
                    {{ comment.routeName }}
                </NuxtLink>
                <span v-else class="text-sm font-medium">{{
                    comment.routeName
                }}</span>
            </div>

            <div class="list-card__pills">
                <span v-if="comment.location" class="list-card__pill">
                    <UIcon name="i-lucide-map-pin" class="size-[13px]" />
                    {{ comment.location }}
                </span>
                <UTooltip
                    v-if="comment.difficultyLabel"
                    :text="t('ratings.perceived_difficulty')"
                >
                    <span class="list-card__pill comment-card__pill--primary">
                        <UIcon name="i-lucide-gauge" class="size-[13px]" />
                        {{ t('ratings.felt') }}
                        {{ comment.difficultyLabel }}
                    </span>
                </UTooltip>
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
import { avatarColor, nameInitials } from '~/utils/avatar'
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
.comment-card__date {
    font-size: 0.75rem;
    color: color-mix(in oklab, var(--ui-text-highlighted) 55%, transparent);
    line-height: 1.2;
}

.comment-card__comment-wrap {
    flex: 1;
    min-width: 0;
}

.comment-card__comment {
    font-size: 0.8rem;
    color: color-mix(in oklab, var(--ui-text-highlighted) 70%, transparent);
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

.comment-card__pill--primary {
    color: var(--ui-primary);
    background: color-mix(in oklab, var(--ui-primary) 8%, transparent);
}

.comment-card .list-card__meta-icon {
    margin-top: 3px;
}

.comment-card .list-card__pills {
    padding-left: 22px;
}
</style>
