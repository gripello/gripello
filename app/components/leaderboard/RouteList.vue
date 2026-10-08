<template>
    <LayoutListGroup :data-testid="testId">
        <LayoutListRow
            v-for="route in routes"
            :key="route.id"
            :to="gymPath(`/route?id=${route.id}`)"
        >
            <RouteSummary :route="route" class="flex-1">
                <template #meta>
                    <span class="flex items-center gap-2 tabular-nums">
                        <span v-if="route.points" class="font-semibold">{{
                            t('leaderboard.points', { n: route.points })
                        }}</span>
                        <span v-else>{{
                            t(
                                'leaderboard.sends',
                                { n: route.sends },
                                route.sends,
                            )
                        }}</span>
                        <span
                            v-if="route.flashes"
                            class="flex items-center gap-0.5"
                        >
                            <UIcon
                                name="i-lucide-zap"
                                class="size-3"
                                :aria-label="t('ticks.types.flash')"
                            />
                            <template v-if="!route.points">{{
                                route.flashes
                            }}</template>
                        </span>
                    </span>
                </template>
            </RouteSummary>
        </LayoutListRow>
    </LayoutListGroup>
</template>

<script setup lang="ts">
import type { LeaderboardRoute } from '~/utils/leaderboard'

defineProps<{ routes: LeaderboardRoute[]; testId?: string }>()

const { t } = useI18n()
const gymPath = useGymPath()
</script>
