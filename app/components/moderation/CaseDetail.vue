<template>
    <article
        class="flex flex-col overflow-hidden rounded-lg bg-default ring ring-default"
        :data-testid="`moderation-detail-${item.id}`"
    >
        <header
            class="flex flex-wrap items-center gap-3 border-b border-default px-5 py-4"
        >
            <RouteSummary
                v-if="context.route"
                :route="context.route"
                :meta="typeLine"
                class="flex-1"
            />
            <template v-else>
                <span
                    class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-primary"
                >
                    <UIcon
                        :name="CONTENT_ICONS[item.content_type]"
                        class="size-[18px]"
                    />
                </span>
                <div class="min-w-0 flex-1">
                    <h2 class="truncate text-base font-bold text-highlighted">
                        {{ title }}
                    </h2>
                    <p class="text-xs text-muted">{{ typeLine }}</p>
                </div>
            </template>
            <UButton
                v-if="contextLink"
                :to="contextLink"
                target="_blank"
                color="neutral"
                variant="ghost"
                icon="i-lucide-external-link"
                data-testid="moderation-context-link"
            >
                {{ t('moderation.viewInContext') }}
            </UButton>
        </header>

        <div class="flex flex-col gap-5 px-5 py-4">
            <div class="flex gap-3">
                <ClimberAvatar
                    :src="authorAvatar"
                    :name="context.author?.name || t('comments.anonymous')"
                    size="sm"
                />
                <div class="flex min-w-0 flex-1 flex-col gap-2">
                    <p class="text-sm">
                        <strong class="text-highlighted">
                            {{
                                context.author?.name || t('comments.anonymous')
                            }}
                        </strong>
                        <span class="text-muted">
                            · {{ timeAgo(item.created, t, locale) }}
                            <template v-if="context.history?.items">
                                ·
                                {{
                                    t(
                                        'moderation.authorPosts',
                                        context.history.items,
                                    )
                                }},
                                {{
                                    t(
                                        'moderation.authorHidden',
                                        context.history.hidden,
                                    )
                                }}
                            </template>
                        </span>
                    </p>
                    <blockquote
                        v-if="text"
                        class="rounded-xl bg-muted px-4 py-3 text-[0.9375rem] leading-relaxed whitespace-pre-line italic"
                        data-testid="moderation-detail-text"
                    >
                        {{ text }}
                    </blockquote>
                    <template v-for="file in files" :key="file.name">
                        <video
                            v-if="file.video"
                            :src="fileUrl(file)"
                            controls
                            preload="metadata"
                            class="max-h-80 w-full rounded-xl bg-inverted"
                        />
                        <img
                            v-else
                            :src="fileUrl(file)"
                            alt=""
                            loading="lazy"
                            class="max-h-56 max-w-full rounded-xl object-contain"
                        />
                    </template>
                </div>
            </div>

            <p
                v-if="item.state === 'hidden' || item.state === 'approved'"
                class="rounded-lg px-4 py-3 text-sm ring ring-default"
                data-testid="moderation-decision-note"
            >
                <strong class="text-highlighted">{{ decisionTitle }}</strong>
                <template v-if="item.reason"> · {{ item.reason }}</template>
                <template v-if="item.reviewed_at">
                    · {{ timeAgo(item.reviewed_at, t, locale) }}
                </template>
            </p>

            <section v-if="context.reports.length" class="flex flex-col gap-2">
                <h3 class="text-sm font-semibold text-highlighted">
                    {{ t('moderation.reportsTitle', context.reports.length) }}
                </h3>
                <LayoutListGroup>
                    <li
                        v-for="report in context.reports"
                        :key="report.id"
                        class="flex flex-col gap-0.5 px-4 py-3 text-sm"
                        :data-testid="`moderation-report-${report.id}`"
                    >
                        <span class="flex flex-wrap items-center gap-2">
                            <strong class="text-highlighted">
                                {{ t(`reports.reasons.${report.reason}`) }}
                            </strong>
                            <span class="text-muted">
                                {{ report.notifier_name }} ·
                                {{ timeAgo(report.created, t, locale) }}
                            </span>
                            <UBadge
                                v-if="report.status !== 'open'"
                                color="neutral"
                                variant="soft"
                                size="sm"
                            >
                                {{ t(`reports.status.${report.status}`) }}
                            </UBadge>
                        </span>
                        <span v-if="report.explanation">
                            {{ report.explanation }}
                        </span>
                    </li>
                </LayoutListGroup>
            </section>

            <section
                v-if="platform && context.author"
                class="flex flex-wrap items-center gap-2 rounded-xl bg-muted px-4 py-3"
                data-testid="moderation-author-panel"
            >
                <span class="me-auto text-sm font-semibold text-highlighted">
                    {{ context.author.name }}
                </span>
                <UButton
                    color="neutral"
                    variant="outline"
                    size="sm"
                    data-testid="moderation-author-filter"
                    @click="emit('showAuthor')"
                >
                    {{ t('moderation.author.showAll') }}
                </UButton>
                <UButton
                    color="neutral"
                    variant="outline"
                    size="sm"
                    data-testid="moderation-author-hide"
                    @click="emit('hideAuthor')"
                >
                    {{ t('moderation.author.hideAll') }}
                </UButton>
                <UButton
                    color="error"
                    variant="outline"
                    size="sm"
                    data-testid="moderation-author-suspend"
                    @click="emit('suspendAuthor')"
                >
                    {{ t('moderation.author.suspend') }}
                </UButton>
            </section>
        </div>

        <footer
            v-if="actions.length"
            class="mt-auto flex flex-wrap items-center gap-2 border-t border-default px-5 py-3"
        >
            <p class="me-auto min-w-48 flex-1 text-xs text-muted">
                {{ consequence }}
            </p>
            <UButton
                v-for="action in actions"
                :key="action"
                :color="ACTION_COLORS[action]"
                :variant="
                    action === 'hide' ||
                    action === 'reject' ||
                    action === 'restore'
                        ? 'outline'
                        : 'solid'
                "
                :icon="ACTION_ICONS[action]"
                :loading="busy"
                :data-testid="`moderation-${action}`"
                @click="emit('act', action)"
            >
                {{ t(actionLabelKey(item, action)) }}
            </UButton>
        </footer>
    </article>
</template>

<script setup lang="ts">
import type { ModerationAction, ModerationItemRecord } from '~/types/models'
import {
    CONTENT_ICONS,
    actionLabelKey,
    moderationFiles,
    moderationText,
    openReportCount,
    type ModerationFile,
} from '~/utils/moderation'
import { timeAgo } from '#shared/utils/formatting'

const props = defineProps<{
    item: ModerationItemRecord
    actions: ModerationAction[]
    platform?: boolean
    busy?: boolean
    fileToken: string
}>()
const emit = defineEmits<{
    act: [action: ModerationAction]
    showAuthor: []
    hideAuthor: []
    suspendAuthor: []
}>()

const ACTION_COLORS: Record<ModerationAction, 'success' | 'neutral' | 'error'> =
    { approve: 'success', restore: 'neutral', reject: 'error', hide: 'error' }
const ACTION_ICONS: Record<ModerationAction, string> = {
    approve: 'i-lucide-check',
    restore: 'i-lucide-eye',
    reject: 'i-lucide-x',
    hide: 'i-lucide-eye-off',
}

const { t, locale } = useI18n()
const pb = usePocketbase()

const context = computed(() => props.item.context ?? { reports: [] as never[] })
const text = computed(() => moderationText(props.item))
const files = computed(() => moderationFiles(props.item))
const openReports = computed(() => openReportCount(context.value.reports))
const authorAvatar = computed(() =>
    context.value.author
        ? climberFileUrl(
              context.value.author.id,
              context.value.author.avatar,
              '100x100',
          )
        : null,
)
const title = computed(
    () =>
        context.value.route?.name ??
        context.value.competition ??
        t(`moderation.types.${props.item.content_type}`),
)
const typeLine = computed(() =>
    [
        t(`moderation.types.${props.item.content_type}`),
        props.platform ? context.value.gym_name : '',
    ]
        .filter(Boolean)
        .join(' · '),
)
const contextLink = computed(() => {
    const route = context.value.route
    const id = props.item.content_id
    switch (props.item.content_type) {
        case 'rating':
            return route ? `/route?id=${route.id}#comment-${id}` : null
        case 'beta_video':
            return route && props.item.state !== 'pending'
                ? `/route?id=${route.id}#beta-${id}`
                : null
        case 'route':
            return `/route?id=${id}`
        case 'profile':
            return `/climber?id=${id}`
    }
    return null
})
const decisionTitle = computed(() => {
    if (props.item.state === 'approved') return t('moderation.keptNote')
    return props.item.hidden_by === 'platform'
        ? t('moderation.hiddenByPlatform')
        : t('moderation.hiddenByGym')
})
const consequence = computed(() => {
    if (props.item.state === 'pending')
        return t('moderation.consequence.pending')
    if (props.item.state === 'hidden')
        return t('moderation.consequence.restore')
    return openReports.value
        ? t('moderation.consequence.reports', openReports.value)
        : t('moderation.consequence.author')
})

function fileUrl(file: ModerationFile) {
    return pb.files.getURL(file, file.name, { token: props.fileToken })
}
</script>
