<template>
    <div v-for="group in days" :key="group.day" class="mb-6 last:mb-0">
        <h3
            class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase"
        >
            {{ dayLabel(group.day) }}
        </h3>
        <ul
            class="divide-y divide-default overflow-hidden rounded-2xl bg-elevated/50 ring ring-default"
        >
            <li
                v-for="tick in group.ticks"
                :key="tick.id"
                class="flex items-center gap-3 px-4 py-3"
                data-testid="feed-send"
            >
                <NuxtLink
                    v-if="!hideUser"
                    :to="`/climber?id=${tick.user}`"
                    :aria-label="nameOf(tick.user)"
                    class="shrink-0"
                >
                    <ClimberAvatar
                        :id="tick.user"
                        :name="nameOf(tick.user)"
                        :avatar="climbers?.get(tick.user)?.avatar"
                    />
                </NuxtLink>
                <RouteColorDot
                    v-else
                    :color="tick.expand?.route?.color"
                    :size="32"
                />
                <span class="min-w-0 flex-1">
                    <span class="flex min-w-0 items-center gap-2 text-sm">
                        <NuxtLink
                            v-if="!hideUser"
                            :to="`/climber?id=${tick.user}`"
                            class="truncate font-semibold text-highlighted hover:underline"
                        >
                            {{ nameOf(tick.user) }}
                        </NuxtLink>
                        <NuxtLink
                            v-else-if="tick.route"
                            :to="`/route?id=${tick.route}`"
                            class="truncate font-semibold text-highlighted hover:underline"
                        >
                            {{ routeName(tick) }}
                        </NuxtLink>
                        <span v-else class="truncate font-semibold text-muted">
                            {{ routeName(tick) }}
                        </span>
                        <UBadge
                            :color="TICK_TYPE_COLORS[tick.type]"
                            variant="soft"
                            size="sm"
                            :icon="TICK_TYPE_ICONS[tick.type]"
                            class="shrink-0"
                        >
                            {{ t(`ticks.types.${tick.type}`) }}
                        </UBadge>
                    </span>
                    <template v-if="!hideUser">
                        <NuxtLink
                            v-if="tick.route"
                            :to="`/route?id=${tick.route}`"
                            class="mt-0.5 flex items-center gap-2 text-sm text-muted hover:text-primary"
                        >
                            <RouteColorDot
                                :color="tick.expand?.route?.color"
                                :size="14"
                            />
                            <span class="truncate">{{ routeName(tick) }}</span>
                        </NuxtLink>
                        <span
                            v-else
                            class="mt-0.5 block truncate text-sm text-muted"
                        >
                            {{ routeName(tick) }}
                        </span>
                    </template>
                    <span v-else class="mt-0.5 block text-xs text-muted">
                        {{ ago(tick.created ?? tick.date) }}
                    </span>
                </span>
                <span class="flex shrink-0 flex-col items-end gap-0.5">
                    <GradeLabel
                        v-if="tick.expand?.route"
                        :source="tick.expand.route"
                    />
                    <span v-if="!hideUser" class="text-xs text-muted">{{
                        ago(tick.created ?? tick.date)
                    }}</span>
                </span>
            </li>
        </ul>
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
const routeName = (tick: FeedTick) =>
    tick.expand?.route?.name || tick.route_name || t('ticks.removedRoute')
const ago = (at: string) => (hydrated.value ? timeAgo(at, t, locale.value) : '')
const dayLabel = (day: string) =>
    activityDayLabel(day, t, locale.value, hydrated.value ? new Date() : null)
</script>
