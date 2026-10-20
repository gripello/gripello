<template>
    <div class="flex flex-col gap-4" data-testid="leaderboard-insights">
        <LayoutPanel padding="sm">
            <div
                class="grid grid-cols-2 gap-y-3 sm:grid-cols-4"
                data-testid="leaderboard-stats"
            >
                <LayoutStatTile
                    :label="t('leaderboard.stats.climbers')"
                    :value="board.stats.climbers"
                    icon="i-lucide-users"
                />
                <LayoutStatTile
                    :label="t('ticks.stats.sends')"
                    :value="board.stats.sends"
                    icon="i-lucide-check-check"
                    icon-color="success"
                />
                <LayoutStatTile
                    :label="t('ticks.types.flash')"
                    :value="board.stats.flashes"
                    icon="i-lucide-zap"
                    icon-color="warning"
                />
                <LayoutStatTile
                    :label="t('ticks.stats.hardest')"
                    :value="board.stats.hardest || '—'"
                    icon="i-lucide-trending-up"
                    icon-color="primary"
                />
            </div>
        </LayoutPanel>

        <section v-if="board.grades.length">
            <LayoutSectionHeader :title="t('leaderboard.stats.grades')" />
            <LayoutPanel padding="sm">
                <LogbookPyramidChart :rows="gradePyramid(board.grades)" />
            </LayoutPanel>
        </section>

        <section v-if="board.topRoutes.length">
            <LayoutSectionHeader :title="t('leaderboard.stats.topRoutes')" />
            <LeaderboardRouteList
                :routes="board.topRoutes"
                test-id="leaderboard-top-routes"
            />
        </section>
    </div>
</template>

<script setup lang="ts">
import { gradePyramid, type Leaderboard } from '~/utils/leaderboard'

defineProps<{ board: Leaderboard }>()

const { t } = useI18n()
</script>
