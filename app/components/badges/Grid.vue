<template>
    <div id="achievements" data-testid="badges">
        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        />
        <LayoutLoadingState v-else-if="!achievements.length && pending" />
        <template v-else>
            <div v-if="weeks" class="mb-6 grid grid-cols-2 gap-3">
                <div
                    v-for="tile in streakTiles"
                    :key="tile.key"
                    class="flex items-center gap-3 rounded-lg bg-default p-4 ring ring-default"
                    :data-testid="`streak-${tile.key}`"
                >
                    <UIcon
                        :name="tile.icon"
                        class="size-8 shrink-0 text-warning"
                    />
                    <div>
                        <div
                            class="text-2xl font-black text-highlighted tabular-nums"
                        >
                            {{
                                t('badges.weeks', { n: tile.value }, tile.value)
                            }}
                        </div>
                        <div class="text-sm text-muted">{{ tile.label }}</div>
                    </div>
                </div>
            </div>

            <section
                v-for="group in groups"
                :key="group.category"
                class="mb-6 last:mb-0"
            >
                <LayoutSectionHeader
                    :title="t(`achievements.categories.${group.category}`)"
                />
                <ul
                    class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6"
                >
                    <li
                        v-for="item in group.items"
                        :key="item.key"
                        class="flex flex-col items-center gap-2 rounded-lg p-4 text-center ring ring-default"
                        :class="item.tier ? 'bg-default' : 'bg-elevated/40'"
                        :data-testid="`badge-${item.key}`"
                        :data-tier="item.tier"
                    >
                        <span
                            class="relative flex size-14 items-center justify-center rounded-full"
                            :class="TIER_STYLES[tierStyle(item)]"
                        >
                            <UIcon :name="item.icon" class="size-7" />
                            <span
                                v-if="item.tiers.length > 1 && item.tier"
                                class="absolute -end-1 -bottom-1 flex size-6 items-center justify-center rounded-full bg-default text-xs font-black text-highlighted ring ring-default"
                            >
                                {{ item.tier }}
                            </span>
                        </span>
                        <span
                            class="text-sm font-semibold"
                            :class="
                                item.tier ? 'text-highlighted' : 'text-muted'
                            "
                        >
                            {{ t(`achievements.names.${item.key}`) }}
                        </span>
                        <span class="text-xs text-muted">
                            {{
                                t(
                                    `achievements.rules.${item.key}`,
                                    { n: goalOf(item) },
                                    goalOf(item),
                                )
                            }}
                        </span>
                        <template v-if="nextTier(item)">
                            <UProgress
                                :model-value="
                                    Math.min(item.value, goalOf(item))
                                "
                                :max="goalOf(item)"
                                size="sm"
                                class="w-full"
                                :ui="{
                                    indicator:
                                        item.value > 0 ? '' : 'invisible',
                                }"
                            />
                            <span class="text-xs text-muted tabular-nums">
                                {{ item.value }} / {{ goalOf(item) }}
                            </span>
                        </template>
                        <span
                            v-else-if="lastEarned(item)"
                            class="text-xs text-muted tabular-nums"
                        >
                            {{
                                formatDate(tickDate(lastEarned(item)!), {
                                    locale,
                                    dateStyle: 'medium',
                                })
                            }}
                        </span>
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>

<script setup lang="ts">
import { listClimberAchievements } from '~/api/social'
import { formatDate } from '#shared/utils/formatting'
import { tickDate } from '#shared/utils/ticks'
import {
    groupAchievements,
    nextTier,
    tierStyle,
    type AchievementView,
} from '~/utils/achievements'

const props = defineProps<{ userId: string }>()

const TIER_STYLES = {
    locked: 'bg-accented text-dimmed',
    earned: 'bg-primary/15 text-primary',
    complete: 'bg-warning/20 text-warning',
}

const { t, locale } = useI18n()

const {
    data: achievements,
    pending,
    error,
} = useAsyncData(
    `achievements:${props.userId}`,
    () => listClimberAchievements(props.userId),
    { default: () => [] },
)

const groups = computed(() => groupAchievements(achievements.value))
const weeks = computed(() =>
    achievements.value.find((item) => item.key === 'active_weeks'),
)
const goalOf = (item: AchievementView) => nextTier(item) ?? item.tiers.at(-1)!
const lastEarned = (item: AchievementView) => item.earned.at(-1) || null
const streakTiles = computed(() => [
    {
        key: 'current',
        icon: 'i-lucide-flame',
        value: weeks.value?.current ?? 0,
        label: t('badges.currentStreak'),
    },
    {
        key: 'best',
        icon: 'i-lucide-crown',
        value: weeks.value?.value ?? 0,
        label: t('badges.bestStreak'),
    },
])
</script>
