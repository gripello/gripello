<template>
    <ol class="flex flex-col gap-2" :data-testid="testId">
        <li v-for="route in routes" :key="route.id">
            <NuxtLink
                :to="gymPath(`/route?id=${route.id}`)"
                class="flex items-center gap-3 rounded-xl bg-elevated/50 px-3 py-2 hover:bg-accented/60"
            >
                <RouteColorDot :color="route.color" :size="28" />
                <span class="min-w-0 flex-1 truncate font-medium">
                    {{ route.name }}
                </span>
                <span
                    class="flex shrink-0 items-center gap-2 text-sm text-muted tabular-nums"
                >
                    <span v-if="route.points" class="font-semibold">{{
                        t('leaderboard.points', { n: route.points })
                    }}</span>
                    <span v-else>{{
                        t('leaderboard.sends', { n: route.sends }, route.sends)
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
                    <span class="font-bold text-highlighted">{{
                        route.grade
                    }}</span>
                </span>
            </NuxtLink>
        </li>
    </ol>
</template>

<script setup lang="ts">
import type { LeaderboardRoute } from '~/utils/leaderboard'

defineProps<{ routes: LeaderboardRoute[]; testId?: string }>()

const { t } = useI18n()
const gymPath = useGymPath()
</script>
