<template>
    <div
        class="relative flex h-dvh flex-col gap-6 overflow-hidden bg-(--app-bg) p-6 text-default lg:p-10"
        data-testid="leaderboard-tv"
    >
        <div
            class="pointer-events-none absolute inset-x-0 top-0 h-72 bg-linear-to-b from-primary/10 to-transparent"
        />
        <header class="relative flex items-center gap-6">
            <LayoutBrandLogo
                v-if="gym"
                :gym="gym"
                class="tv-logo hidden md:flex"
            />
            <div class="min-w-0 flex-1">
                <p class="mb-1 text-xl text-muted">{{ seasonLabel }}</p>
                <h1
                    class="truncate text-4xl font-black tracking-tight text-highlighted lg:text-6xl"
                >
                    {{ t('leaderboard.title') }}
                </h1>
            </div>
            <div
                class="hidden text-right text-5xl font-light text-muted tabular-nums md:block"
            >
                {{ clock }}
            </div>
            <div
                v-if="qrDataUrl"
                class="flex flex-col items-center gap-1 rounded-2xl bg-white p-3 shadow-sm ring ring-default"
            >
                <img
                    :src="qrDataUrl"
                    :alt="t('leaderboard.title')"
                    class="size-32 lg:size-44"
                />
            </div>
        </header>

        <div
            v-if="!columns.length"
            class="flex flex-1 flex-col items-center justify-center gap-6 text-center"
        >
            <UIcon name="i-lucide-medal" class="size-32 text-dimmed" />
            <p class="text-4xl font-semibold text-muted">
                {{ t('leaderboard.empty') }}
            </p>
        </div>

        <div
            v-else
            class="relative mx-auto grid min-h-0 w-full flex-1 items-start gap-6"
            :class="columns.length === 1 ? 'max-w-5xl' : ''"
            :style="{
                gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
            }"
        >
            <section
                v-for="column in columns"
                :key="column.kind"
                class="flex max-h-full min-h-0 flex-col rounded-2xl bg-default p-4 shadow-sm ring ring-default"
                :data-testid="`leaderboard-tv-${column.kind}`"
            >
                <h2
                    class="mb-3 flex items-center gap-3 px-2 text-2xl font-bold text-highlighted lg:text-3xl"
                >
                    <span class="h-7 w-1.5 shrink-0 rounded-full bg-primary" />
                    {{ t(`ticks.kind.${column.kind}`) }}
                </h2>
                <TransitionGroup
                    tag="ol"
                    move-class="transition-transform duration-700 ease-out"
                    class="flex min-h-0 flex-col gap-2 overflow-hidden"
                >
                    <li
                        v-for="row in column.rows"
                        :key="row.user"
                        class="flex items-center gap-4 rounded-xl px-3 py-2.5 lg:py-3"
                        :class="PODIUM_ROWS[row.rank] ?? 'bg-elevated/50'"
                    >
                        <span
                            class="flex size-11 shrink-0 items-center justify-center rounded-full text-xl font-black tabular-nums"
                            :class="
                                MEDALS[row.rank] ??
                                'text-muted ring ring-default'
                            "
                            >{{ row.rank }}</span
                        >
                        <span
                            class="min-w-0 flex-1 truncate text-xl font-semibold text-highlighted lg:text-2xl"
                        >
                            {{ row.name || t('leaderboard.anonymous') }}
                        </span>
                        <span
                            class="shrink-0 text-2xl font-black text-highlighted tabular-nums lg:text-3xl"
                        >
                            {{ formatNumber(row.score, locale, 0) }}
                        </span>
                    </li>
                </TransitionGroup>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { SeasonRecord } from '~/types/models'
import { formatNumber } from '#shared/utils/number'
import { localDay } from '#shared/utils/ticks'
import {
    LEADERBOARD_KINDS,
    ROLLING_SEASON,
    defaultSeason,
    leaderboardPath,
    type Leaderboard,
} from '~/utils/leaderboard'
import { MEDALS, PODIUM_ROWS } from '~/utils/themeColors'

definePageMeta({ layout: false })

const TV_ROWS = 15
const REFRESH_MS = 60_000

const { t, locale } = useI18n()
const pb = usePocketbase()
const gymId = useCurrentGymId()
const gymPath = useGymPath()
const { gym } = useGym()
const requestUrl = useRequestURL({
    xForwardedHost: true,
    xForwardedProto: true,
})

useHead({ title: t('page.title.leaderboard') })

function loadSeason() {
    return pb
        .collection('seasons')
        .getFullList<SeasonRecord>({
            filter: gymFilter(pb, gymId.value),
            requestKey: null,
        })
        .then(
            (seasons) =>
                seasons.find(
                    (entry) =>
                        entry.id ===
                        defaultSeason(seasons, localDay(new Date())),
                ) ?? null,
        )
}

function loadBoards(seasonId: string) {
    return Promise.all(
        LEADERBOARD_KINDS.map((kind) =>
            pb
                .send<Leaderboard>(
                    leaderboardPath(gymId.value, kind, seasonId),
                    { requestKey: null },
                )
                .then((board) => ({
                    kind,
                    rows: board.rows.slice(0, TV_ROWS),
                })),
        ),
    )
}

const { data: season } = await useAsyncData('leaderboard-tv-season', loadSeason)

const { data: boards } = await useAsyncData(
    'leaderboard-tv',
    () => loadBoards(season.value?.id ?? ROLLING_SEASON),
    { default: () => [] },
)

async function refreshWall() {
    try {
        const nextSeason = await loadSeason()
        boards.value = await loadBoards(nextSeason?.id ?? ROLLING_SEASON)
        season.value = nextSeason
    } catch {
        // the wall screen keeps the last good board through network blips
    }
}

const columns = computed(() =>
    boards.value.filter((column) => column.rows.length),
)
const seasonLabel = computed(
    () => season.value?.name ?? t('leaderboard.rolling'),
)

const now = ref<Date | null>(null)
const clock = computed(() =>
    now.value
        ? new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(
              now.value,
          )
        : '',
)

const qrDataUrl = ref('')
const timers: ReturnType<typeof setInterval>[] = []
onMounted(async () => {
    now.value = new Date()
    timers.push(
        setInterval(() => (now.value = new Date()), 1000),
        setInterval(() => void refreshWall(), REFRESH_MS),
    )
    const { default: QRCode } = await import('qrcode')
    qrDataUrl.value = await QRCode.toDataURL(
        `${requestUrl.origin}${gymPath('/leaderboard')}`,
        { width: 768, margin: 1 },
    )
})
onBeforeUnmount(() => timers.forEach(clearInterval))
</script>

<style scoped>
.tv-logo :deep(img) {
    max-width: 160px;
    max-height: 72px;
}
</style>
