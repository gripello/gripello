<template>
    <div v-if="!title || days.length" data-testid="logbook-timeline">
        <LayoutSectionHeader v-if="title" :title="title" />
        <div v-if="!title" class="mb-4 flex">
            <SegmentedControl
                v-model="filter"
                :items="filterItems"
                size="sm"
                test-id="timeline-filter"
            />
        </div>
        <LayoutEmptyState
            v-if="contributionsError"
            variant="error"
            :title="t('errors.loadFailed')"
        />
        <LayoutLoadingState v-else-if="pending && !days.length" />
        <LayoutEmptyState
            v-else-if="!days.length"
            icon="i-lucide-history"
            :title="t('timeline.empty')"
            data-testid="timeline-empty"
        />
        <div v-for="group in days" :key="group.day" class="mb-6 last:mb-0">
            <h3
                class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase"
            >
                {{ activityDayLabel(group.day, t, locale) }}
            </h3>
            <ul
                class="divide-y divide-default overflow-hidden rounded-2xl bg-elevated/50 ring ring-default"
            >
                <li
                    v-for="entry in group.entries"
                    :key="`${entry.kind}-${entry.id}`"
                    class="flex items-start gap-3 px-4 py-3"
                    :data-testid="`timeline-${entry.kind}`"
                >
                    <span
                        class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                    >
                        <UIcon :name="KIND_ICONS[entry.kind]" class="size-5" />
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="flex min-w-0 items-center gap-2 text-sm">
                            <RouteColorDot :color="entry.color" :size="14" />
                            <NuxtLink
                                v-if="entry.routeId"
                                :to="routeLink(entry)"
                                class="truncate font-semibold text-highlighted hover:underline"
                            >
                                {{ entry.routeName || t('timeline.deleted') }}
                            </NuxtLink>
                            <span
                                v-else
                                class="truncate font-semibold text-muted"
                                data-testid="timeline-removed-route"
                            >
                                {{ entry.routeName || t('ticks.removedRoute') }}
                            </span>
                            <UBadge
                                v-if="entry.tickType"
                                :color="TICK_COLORS[entry.tickType]"
                                variant="soft"
                                size="sm"
                                class="shrink-0"
                            >
                                {{ t(`ticks.types.${entry.tickType}`) }}
                            </UBadge>
                            <span
                                v-else-if="entry.rating"
                                class="flex shrink-0"
                                role="img"
                                :aria-label="`${entry.rating}/5`"
                            >
                                <UIcon
                                    v-for="star in 5"
                                    :key="star"
                                    name="i-lucide-star"
                                    mode="svg"
                                    class="size-3.5"
                                    :class="
                                        star <= entry.rating
                                            ? 'text-amber-500 **:fill-current'
                                            : 'text-dimmed'
                                    "
                                />
                            </span>
                            <UBadge
                                v-else-if="entry.kind === 'beta'"
                                color="neutral"
                                variant="soft"
                                size="sm"
                                class="shrink-0"
                            >
                                {{ t('timeline.beta') }}
                            </UBadge>
                        </span>
                        <span
                            v-if="entry.comment"
                            class="mt-1 line-clamp-2 text-sm text-muted"
                        >
                            {{ entry.comment }}
                        </span>
                    </span>
                    <span class="shrink-0 text-xs text-muted">
                        {{ timeAgo(entry.at, t, locale) }}
                    </span>
                </li>
            </ul>
        </div>
    </div>
</template>

<script setup lang="ts">
import { timeAgo } from '#shared/utils/formatting'
import { activityDayLabel } from '~/utils/feed'
import {
    TIMELINE_KINDS,
    timelineDays,
    type Contribution,
    type TimelineEntry,
    type TimelineFilter,
    type TimelineTick,
} from '~/utils/timeline'

const KIND_ICONS = {
    send: 'i-lucide-check',
    attempt: 'i-lucide-repeat',
    review: 'i-lucide-message-square-text',
    beta: 'i-lucide-video',
} as const
const TICK_COLORS = {
    flash: 'warning',
    top: 'success',
    attempt: 'neutral',
} as const

const props = defineProps<{
    ticks: TimelineTick[]
    gymId: string
    title?: string
}>()

const { t, locale } = useI18n()
const pb = usePocketbase()
const filter = ref<TimelineFilter>('all')
const filterItems = computed(() =>
    TIMELINE_KINDS.map((value) => ({
        value,
        label: t(`timeline.filters.${value}`),
    })),
)

const {
    data: contributions,
    pending,
    error: contributionsError,
    refresh: refreshContributions,
} = useAsyncData(
    'my-contributions',
    () =>
        pb.send<{ reviews: Contribution[]; betas: Contribution[] }>(
            '/api/account/contributions',
            { requestKey: null },
        ),
    { server: false, default: () => ({ reviews: [], betas: [] }) },
)

let activated = false
onActivated(() => {
    if (activated) refreshContributions()
    activated = true
})

const days = computed(() =>
    timelineDays(
        props.ticks,
        contributions.value.reviews,
        contributions.value.betas,
        filter.value,
        props.gymId,
    ),
)

const routeLink = (entry: TimelineEntry) =>
    entry.kind === 'beta'
        ? `/route?id=${entry.routeId}#beta-${entry.id}`
        : `/route?id=${entry.routeId}`
</script>
