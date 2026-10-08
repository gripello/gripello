<template>
    <component
        :is="linked ? NuxtLink : 'div'"
        :to="linked ? `/climber?id=${row.user}` : undefined"
        class="flex items-center gap-3 rounded-lg px-3 py-2.5"
        :class="[
            highlighted
                ? 'bg-primary/10 ring ring-primary/40'
                : (PODIUM_ROWS[row.rank] ?? 'bg-elevated/50'),
            linked && 'hover:bg-accented/60',
        ]"
        :data-testid="`leaderboard-row-${row.user}`"
    >
        <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-black tabular-nums"
            :class="MEDALS[row.rank] ?? 'text-muted ring ring-default'"
            >{{ row.rank }}</span
        >
        <ClimberAvatar
            :id="row.user"
            :name="displayName"
            :avatar="row.avatar"
            size="sm"
        />
        <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold text-highlighted">
                {{ displayName }}
            </span>
            <span class="flex gap-2 text-xs text-muted tabular-nums">
                <span>{{
                    t('leaderboard.sends', { n: row.sends }, row.sends)
                }}</span>
                <span v-if="row.flashes" class="flex items-center gap-0.5">
                    <UIcon name="i-lucide-zap" class="size-3" />{{
                        row.flashes
                    }}
                </span>
                <span v-if="row.hardest" class="flex items-center gap-0.5">
                    <UIcon name="i-lucide-trending-up" class="size-3" />{{
                        row.hardest
                    }}
                </span>
            </span>
        </span>
        <span
            class="shrink-0 text-lg font-black text-highlighted tabular-nums"
            data-testid="leaderboard-score"
        >
            {{ formatNumber(row.score, locale, 0) }}
        </span>
    </component>
</template>

<script setup lang="ts">
import { formatNumber } from '#shared/utils/number'
import { MEDALS, PODIUM_ROWS } from '~/utils/themeColors'
import type { LeaderboardRow } from '~/utils/leaderboard'

const props = defineProps<{
    row: LeaderboardRow
    highlighted?: boolean
    linked?: boolean
}>()

const NuxtLink = resolveComponent('NuxtLink')
const { t, locale } = useI18n()
const displayName = computed(() => props.row.name || t('leaderboard.anonymous'))
</script>
