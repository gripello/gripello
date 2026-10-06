<template>
    <UCard data-testid="leaderboard-standing">
        <div class="mb-4 grid grid-cols-3">
            <LayoutStatTile
                :label="t('leaderboard.standing.rank')"
                :value="`#${me.rank}`"
                icon="i-lucide-medal"
                icon-color="primary"
            />
            <LayoutStatTile
                :label="t('leaderboard.standing.score')"
                :value="formatNumber(me.score, locale, 0)"
            />
            <LayoutStatTile
                :label="t('leaderboard.standing.ahead')"
                :value="ahead === null ? '—' : formatNumber(ahead, locale, 0)"
                icon="i-lucide-arrow-up"
                data-testid="leaderboard-ahead"
            />
        </div>
        <LayoutSectionHeader :title="t('leaderboard.standing.bestSends')" />
        <LeaderboardRouteList :routes="sends" test-id="leaderboard-my-sends" />
    </UCard>
</template>

<script setup lang="ts">
import { formatNumber } from '#shared/utils/number'
import type { LeaderboardRoute, LeaderboardRow } from '~/utils/leaderboard'

defineProps<{
    me: LeaderboardRow
    ahead: number | null
    sends: LeaderboardRoute[]
}>()

const { t, locale } = useI18n()
</script>
