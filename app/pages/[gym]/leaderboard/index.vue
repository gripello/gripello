<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader :title="t('leaderboard.title')">
            <template #actions>
                <div class="flex flex-wrap items-center gap-2">
                    <SegmentedControl
                        v-model="kind"
                        :items="kindItems"
                        size="sm"
                        test-id="leaderboard-kind"
                    />
                    <USelect
                        v-model="season"
                        :items="seasonItems"
                        size="sm"
                        class="min-w-36"
                        :aria-label="t('leaderboard.season')"
                        data-testid="leaderboard-season"
                    />
                    <UButton
                        v-if="canManage"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-calendar-range"
                        class="icon-btn"
                        :aria-label="t('leaderboard.seasons.title')"
                        data-testid="leaderboard-seasons-open"
                        @click="seasonsOpen = true"
                    />
                    <UButton
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-tv"
                        class="icon-btn hidden md:inline-flex"
                        :aria-label="t('leaderboard.tv')"
                        :to="gymPath('/leaderboard/tv')"
                        target="_blank"
                        data-testid="leaderboard-tv"
                    />
                </div>
            </template>
        </LayoutPageHeader>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="load-error"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    data-testid="load-error-retry"
                    @click="refresh()"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <template v-else>
            <p
                class="mb-4 text-sm text-muted tabular-nums"
                data-testid="leaderboard-window"
            >
                {{ windowLabel }}
            </p>

            <UAlert
                v-if="hidden"
                color="neutral"
                variant="soft"
                icon="i-lucide-eye-off"
                class="mb-4"
                :title="t('leaderboard.youAreHidden')"
                :actions="[
                    {
                        label: t('leaderboard.showMe'),
                        to: '/account/settings?tab=privacy',
                        color: 'neutral',
                        variant: 'outline',
                    },
                ]"
                data-testid="leaderboard-hidden"
            />
            <LayoutLoadingState v-if="status === 'pending' && !board" />
            <LayoutEmptyState
                v-else-if="!board?.rows.length"
                icon="i-lucide-medal"
                :title="t('leaderboard.empty')"
                data-testid="leaderboard-empty"
            />
            <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-5">
                <div class="lg:col-span-3">
                    <div
                        v-if="board.me && !meVisible"
                        class="mb-4"
                        data-testid="leaderboard-me"
                    >
                        <LeaderboardRow :row="board.me" highlighted />
                    </div>
                    <ol
                        class="flex flex-col gap-2"
                        data-testid="leaderboard-rows"
                    >
                        <li v-for="row in board.rows" :key="row.user">
                            <LeaderboardRow
                                :row="row"
                                :highlighted="row.user === myId"
                                :linked="!!myId && row.user !== myId"
                            />
                        </li>
                    </ol>
                </div>
                <aside class="flex flex-col gap-4 lg:col-span-2">
                    <LeaderboardMyStanding
                        v-if="board.me"
                        :me="board.me"
                        :ahead="board.ahead"
                        :sends="board.mySends"
                    />
                    <LeaderboardInsights :board="board" />
                </aside>
            </div>
        </template>

        <LeaderboardSeasonsDialog
            v-if="canManage"
            v-model="seasonsOpen"
            :seasons="seasons"
            @changed="refreshSeasons()"
        />
    </div>
</template>

<script setup lang="ts">
import { getLeaderboard, listSeasons } from '~/api/ticks'
import { localDay } from '#shared/utils/ticks'
import { formatDate } from '#shared/utils/formatting'
import type { LogbookKind } from '#shared/utils/logbook'
import {
    LEADERBOARD_KINDS,
    ROLLING_SEASON,
    defaultSeason,
    keepSelectableSeason,
    selectableSeasons,
} from '~/utils/leaderboard'

const { t, locale } = useI18n()
const authStore = useAuthStore()
const gymId = useCurrentGymId()
const gymPath = useGymPath()
const { can } = usePermissions()
const canManage = computed(() => can('manage_competitions'))
const myId = authStore.record?.id ?? ''
const hidden = !!authStore.record?.leaderboard_hidden

useHead({ title: t('page.title.leaderboard') })

const { data: seasons, refresh: refreshSeasons } = await useAsyncData(
    'leaderboard-seasons',
    () => listSeasons(gymId.value),
    { default: () => [] },
)

const today = localDay(new Date())
const kind = ref<LogbookKind>('boulder')
const season = useState('leaderboard-season', () =>
    defaultSeason(seasons.value, today),
)
watch(seasons, (list) => {
    season.value = keepSelectableSeason(list, season.value, today)
})
const kindItems = computed(() =>
    LEADERBOARD_KINDS.map((value) => ({
        value,
        label: t(`ticks.kind.${value}`),
    })),
)
const seasonItems = computed(() => [
    { value: ROLLING_SEASON, label: t('leaderboard.rolling') },
    ...selectableSeasons(seasons.value, today).map((entry) => ({
        value: entry.id,
        label: entry.name,
    })),
])

const {
    data: board,
    status,
    error,
    refresh,
} = await useAsyncData(
    'leaderboard',
    () =>
        getLeaderboard(gymId.value, { kind: kind.value, season: season.value }),
    { watch: [kind, season] },
)

const meVisible = computed(
    () => !!board.value?.rows.some((row) => row.user === myId),
)
const windowLabel = computed(() => {
    if (!board.value) return ''
    const range = [board.value.from, board.value.to].map((day) =>
        formatDate(day, { locale: locale.value, dateStyle: 'medium' }),
    )
    return season.value === ROLLING_SEASON
        ? t('leaderboard.rollingWindow', { from: range[0] })
        : range.join(' – ')
})

const seasonsOpen = ref(false)
</script>
