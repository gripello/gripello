<template>
    <div
        class="grid min-h-0 w-full flex-1 gap-8 portrait:grid-cols-1!"
        :style="{
            gridTemplateColumns: `repeat(${boards.length}, minmax(0, 1fr))`,
        }"
    >
        <section
            v-for="board in boards"
            :key="board.kind"
            class="flex min-h-0 flex-col gap-4"
            :data-testid="`leaderboard-tv-${board.kind}`"
        >
            <h2
                class="flex items-center gap-3 text-4xl font-bold text-highlighted"
            >
                <span class="h-9 w-2 shrink-0 rounded-full bg-primary" />
                {{ t(`ticks.kind.${board.kind}`) }}
            </h2>
            <div
                class="flex min-h-0 flex-1 flex-col gap-3"
                :class="{ 'landscape:flex-row landscape:gap-8': single }"
                :style="{ '--rest': restSlots }"
            >
                <TransitionGroup
                    tag="ol"
                    move-class="transition-transform duration-700 ease-out"
                    class="grid min-h-0 basis-0 grid-cols-1 grid-rows-3 gap-3 grow-[6]"
                    :class="{ 'landscape:grow-[2]': single }"
                >
                    <li
                        v-for="row in board.rows.slice(0, 3)"
                        :key="row.user"
                        class="flex min-h-0 items-center gap-[min(1.5rem,12cqh)] rounded-2xl px-6 [container-type:size]"
                        :class="PODIUM_ROWS[row.rank]"
                        :data-testid="`leaderboard-tv-podium-${row.rank}`"
                    >
                        <span
                            class="flex size-[min(5rem,70cqh)] shrink-0 items-center justify-center rounded-full text-[min(2.25rem,32cqh)] font-black tabular-nums"
                            :class="MEDALS[row.rank]"
                            >{{ row.rank }}</span
                        >
                        <span class="flex min-w-0 flex-1 flex-col">
                            <span
                                class="truncate text-[min(3rem,36cqh)] leading-tight font-bold text-highlighted"
                            >
                                {{ row.name || t('leaderboard.anonymous') }}
                            </span>
                            <span
                                class="truncate text-[min(1.5rem,20cqh)] text-muted tabular-nums"
                            >
                                {{
                                    [
                                        row.hardest,
                                        t(
                                            'leaderboard.sends',
                                            { n: row.sends },
                                            row.sends,
                                        ),
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')
                                }}
                            </span>
                        </span>
                        <span
                            class="shrink-0 text-[min(3.75rem,48cqh)] font-black text-highlighted tabular-nums"
                        >
                            {{ formatNumber(row.score, locale, 0) }}
                        </span>
                    </li>
                </TransitionGroup>
                <TransitionGroup
                    v-if="restSlots"
                    tag="ol"
                    move-class="transition-transform duration-700 ease-out"
                    class="grid min-h-0 basis-0 grid-cols-1 grid-rows-[repeat(var(--rest),minmax(0,1fr))] gap-2 grow-(--rest)"
                    :class="{ 'landscape:grow-[3]': single }"
                >
                    <li
                        v-for="row in board.rows.slice(3, rows)"
                        :key="row.user"
                        class="flex min-h-0 items-center gap-5 rounded-xl bg-elevated/50 px-5 text-[min(2.25rem,60cqh)] [container-type:size]"
                    >
                        <span
                            class="w-[1.8em] shrink-0 text-center font-bold text-muted tabular-nums"
                            >{{ row.rank }}</span
                        >
                        <span
                            class="min-w-0 flex-1 truncate font-semibold text-highlighted"
                        >
                            {{ row.name || t('leaderboard.anonymous') }}
                        </span>
                        <span
                            class="shrink-0 font-black text-highlighted tabular-nums"
                        >
                            {{ formatNumber(row.score, locale, 0) }}
                        </span>
                    </li>
                </TransitionGroup>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { formatNumber } from '#shared/utils/number'
import type { TvBoard } from '~/utils/tvScreen'
import { MEDALS, PODIUM_ROWS } from '~/utils/themeColors'

const props = defineProps<{ boards: TvBoard[]; rows: number }>()

const { t, locale } = useI18n()
const single = computed(() => props.boards.length === 1)
const restSlots = computed(() => Math.max(props.rows - 3, 0))
</script>
