<template>
    <div v-for="group in days" :key="group.day" class="mb-6 last:mb-0">
        <LayoutEyebrow>{{ dayLabel(group.day) }}</LayoutEyebrow>
        <LayoutListGroup>
            <LayoutListRow
                v-for="tick in group.ticks"
                :key="tick.id"
                data-testid="feed-send"
            >
                <RouteSummary
                    v-if="hideUser"
                    :route="summaryRoute(tick)"
                    :to="routeLink(tick)"
                    :meta="ago(tick.created ?? tick.date)"
                    :hide-grade="!tick.expand?.route"
                    class="flex-1"
                >
                    <template #markers>
                        <UBadge
                            :color="TICK_TYPE_COLORS[tick.type]"
                            variant="soft"
                            size="sm"
                            :icon="TICK_TYPE_ICONS[tick.type]"
                            class="ml-1 shrink-0"
                        >
                            {{ t(`ticks.types.${tick.type}`) }}
                        </UBadge>
                    </template>
                </RouteSummary>
                <template v-else>
                    <NuxtLink
                        :to="`/climber?id=${tick.user}`"
                        :aria-label="nameOf(tick.user)"
                        class="shrink-0"
                    >
                        <ClimberAvatar
                            :id="tick.user"
                            :name="nameOf(tick.user)"
                            :src="climbers?.get(tick.user)?.avatar"
                        />
                    </NuxtLink>
                    <div class="min-w-0 flex-1">
                        <p class="flex min-w-0 items-center gap-2 text-sm">
                            <NuxtLink
                                :to="`/climber?id=${tick.user}`"
                                class="truncate font-semibold text-highlighted hover:underline"
                            >
                                {{ nameOf(tick.user) }}
                            </NuxtLink>
                            <UBadge
                                :color="TICK_TYPE_COLORS[tick.type]"
                                variant="soft"
                                size="sm"
                                :icon="TICK_TYPE_ICONS[tick.type]"
                                class="shrink-0"
                            >
                                {{ t(`ticks.types.${tick.type}`) }}
                            </UBadge>
                        </p>
                        <RouteSummary
                            :route="summaryRoute(tick)"
                            :to="routeLink(tick)"
                            :hide-grade="!tick.expand?.route"
                            size="sm"
                            class="mt-0.5"
                        />
                    </div>
                    <span class="shrink-0 self-start text-xs text-muted">{{
                        ago(tick.created ?? tick.date)
                    }}</span>
                </template>
            </LayoutListRow>
        </LayoutListGroup>
    </div>
</template>

<script setup lang="ts">
import { timeAgo } from '#shared/utils/formatting'
import { activityDayLabel, activityDays } from '~/utils/feed'
import type { Climber, FeedTick } from '~/utils/friends'
import { TICK_TYPE_COLORS, TICK_TYPE_ICONS } from '~/utils/ticks'

const props = defineProps<{
    ticks: FeedTick[]
    climbers?: Map<string, Climber>
    hideUser?: boolean
}>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const days = computed(() => activityDays(props.ticks))
const nameOf = (userId: string) =>
    props.climbers?.get(userId)?.name || t('feed.someone')
const summaryRoute = (tick: FeedTick) => ({
    ...tick.expand?.route,
    name:
        tick.expand?.route?.name || tick.route_name || t('ticks.removedRoute'),
})
const routeLink = (tick: FeedTick) =>
    tick.route ? `/route?id=${tick.route}` : undefined
const ago = (at: string) => (hydrated.value ? timeAgo(at, t, locale.value) : '')
const dayLabel = (day: string) =>
    activityDayLabel(day, t, locale.value, hydrated.value ? new Date() : null)
</script>
