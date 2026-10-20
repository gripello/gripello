<template>
    <TvShell
        :gym="gym"
        :qr="headerQr"
        :qr-alt="t('tv.scanToOpen')"
        data-testid="gym-tv"
    >
        <template #eyebrow>
            <div
                v-if="takeover || eyebrow"
                class="mb-2 flex flex-wrap items-center gap-3 text-xl text-muted"
            >
                <TvLivePill v-if="takeover" />
                <span v-if="eyebrow" data-testid="tv-eyebrow">{{
                    eyebrow
                }}</span>
            </div>
        </template>
        <template #title>{{ title }}</template>

        <div
            v-if="takeover"
            class="relative flex min-h-0 flex-1 flex-col gap-6"
            data-testid="competition-tv"
        >
            <TvCompetitionStandings :results="takeoverResults" />
        </div>
        <Transition
            v-else
            mode="out-in"
            enter-active-class="transition-opacity duration-700"
            leave-active-class="transition-opacity duration-500"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
        >
            <div
                :key="slide.key"
                class="relative flex min-h-0 flex-1 flex-col"
                :data-testid="`tv-slide-${slide.kind}`"
            >
                <TvNewRoutesSlide
                    v-if="slide.kind === 'new_routes'"
                    :routes="slide.routes"
                    :wall-names="wallNames"
                    :now="now"
                />
                <TvLeaderboard
                    v-else-if="slide.kind === 'leaderboard'"
                    :boards="slide.boards"
                    :rows="TV_BOARD_ROWS"
                />
                <TvResetsSlide
                    v-else-if="slide.kind === 'resets'"
                    :resets="slide.resets"
                />
                <TvPromoSlide
                    v-else-if="slide.kind === 'promo'"
                    :competition="slide.competition"
                    :qr="slideQr"
                />
                <TvAnnouncementSlide
                    v-else-if="slide.kind === 'announcement'"
                    :text="slide.text"
                />
                <TvInfoSlide
                    v-else
                    :hours="gym?.opening_hours"
                    :qr="slideQr"
                    :caption="gymHost"
                />
            </div>
        </Transition>

        <template v-if="!takeover && playlist.length > 1" #footer>
            <div
                class="h-1.5 w-full overflow-hidden rounded-full bg-accented"
                data-testid="tv-progress"
            >
                <div
                    :key="rotation"
                    class="tv-progress h-full rounded-full bg-primary"
                    :style="{
                        animationDuration: `${slideSeconds(slide, screen)}s`,
                    }"
                />
            </div>
        </template>
    </TvShell>
</template>

<script setup lang="ts">
import { leaderboardTopic } from '#shared/utils/topics'
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { listCompetitions } from '~/api/competitions'
import { listRoutes, listWalls } from '~/api/routes'
import { competitionShareUrl } from '~/utils/competitions'
import { qrDataUrl } from '~/utils/qrDataUrl'
import { LEADERBOARD_REFRESH_MS } from '~/utils/leaderboard'
import { cacheKeys } from '~/utils/realtimeCache'
import {
    TV_BOARD_ROWS,
    buildPlaylist,
    knownLocation,
    slideHasQr,
    slideSeconds,
    takeoverCompetition,
    type TvOrientation,
    type TvRoute,
} from '~/utils/tvScreen'
import { tvScreenOf, tvSettingsOf } from '#shared/utils/tvSettings'

definePageMeta({ layout: false })

const REFRESH_MS = 60_000
const CLOCK_MS = 60_000

const { t } = useI18n()
const route = useRoute()
const gymId = useCurrentGymId()
const { gym } = useGym()
const requestUrl = useRequestURL({
    xForwardedHost: true,
    xForwardedProto: true,
})

const settings = computed(() => tvSettingsOf(gym.value))
const screen = computed(() =>
    tvScreenOf(
        settings.value,
        typeof route.query.screen === 'string' ? route.query.screen : '',
    ),
)

const [
    { data: routeRecords },
    { data: wallRecords },
    { data: boardData },
    { data: competitions },
    { data: locations },
] = await Promise.all([
    useOfflineData(
        cacheKeys.overviewRoutes,
        () => listRoutes(gymId.value, {}).then((list) => list.items),
        { default: () => [] },
    ),
    useOfflineData(cacheKeys.overviewWalls, () => listWalls(gymId.value), {
        default: () => [],
    }),
    useAsyncData(
        'gym-tv-boards',
        () => loadTvBoards(gymId.value, TV_BOARD_ROWS),
        { default: () => ({ season: null, boards: [] }) },
    ),
    useAsyncData(
        'gym-tv-competitions',
        () => listCompetitions(gymId.value, { status: ['open'] }),
        { default: () => [] },
    ),
    useLocations(),
])

const locationId = computed(() =>
    knownLocation(screen.value.location, locations.value),
)
const inLocation = <Item extends { location?: string | null }>(
    items: Item[],
) =>
    locationId.value
        ? items.filter((item) => item.location === locationId.value)
        : items
const routes = computed(() => inLocation(routeRecords.value as TvRoute[]))
const walls = computed(() => inLocation(wallRecords.value))
const wallNames = computed(
    () => new Map(wallRecords.value.map((entry) => [entry.id, entry.name])),
)
const locationName = computed(
    () =>
        locations.value.find((entry) => entry.id === locationId.value)?.name ??
        '',
)

// Rendered once with the server's time, so hydration builds the same playlist (unless the server's timezone is already on another day).
const renderedAt = useState('gym-tv-now', () => Date.now())
const now = ref(new Date(renderedAt.value))
const orientation = ref<TvOrientation>('landscape')

const playlist = computed(() =>
    buildPlaylist(
        { ...screen.value, announcements: settings.value.announcements },
        {
            routes: routes.value,
            walls: walls.value,
            boards: boardData.value.boards,
            competitions: competitions.value,
        },
        now.value,
        orientation.value,
    ),
)
const slideIndex = ref(0)
const slide = computed(
    () => playlist.value[slideIndex.value % playlist.value.length]!,
)

const takeover = computed(() =>
    screen.value.takeover
        ? takeoverCompetition(competitions.value, now.value)
        : null,
)
const { data: takeoverResults } = useCompetitionResults(
    computed(() => takeover.value?.id ?? ''),
)

const gymUrl = computed(() => `${requestUrl.origin}/${gym.value?.slug ?? ''}`)
const gymHost = computed(() => `${requestUrl.host}/${gym.value?.slug ?? ''}`)
const slideUrl = computed(() => {
    if (takeover.value)
        return competitionShareUrl(
            requestUrl.origin,
            gym.value?.slug ?? '',
            takeover.value.id,
        )
    const current = slide.value
    return current.kind === 'promo'
        ? competitionShareUrl(
              requestUrl.origin,
              gym.value?.slug ?? '',
              current.competition.id,
          )
        : gymUrl.value
})
const qrCodes = ref<Record<string, string>>({})
const slideQr = computed(() => qrCodes.value[slideUrl.value] ?? '')
const headerQr = computed(() =>
    takeover.value || !slideHasQr(slide.value) ? slideQr.value : '',
)

const title = computed(() => {
    if (takeover.value) return takeover.value.name
    const current = slide.value
    if (current.kind === 'new_routes') return t('tv.newRoutes')
    if (current.kind === 'leaderboard') return t('leaderboard.title')
    if (current.kind === 'resets') return t('tv.resets')
    if (current.kind === 'promo') return current.competition.name
    return gym.value?.name ?? ''
})
const eyebrow = computed(() => {
    const parts = [locationName.value]
    if (!takeover.value && slide.value.kind === 'leaderboard')
        parts.push(boardData.value.season?.name ?? t('leaderboard.rolling'))
    if (!takeover.value && slide.value.kind === 'promo')
        parts.push(t('competitions.phases.registration.title'))
    return parts.filter(Boolean).join(' · ')
})

useHead({ title: () => `${t('tv.title')} · ${gym.value?.name ?? ''}` })

useGymCompetitionsLive(async () => {
    competitions.value = await listCompetitions(gymId.value, {
        status: ['open'],
    })
})

useLiveRefresh(() => leaderboardTopic(gymId.value), refreshScreen, {
    delayMs: LEADERBOARD_REFRESH_MS,
})

async function refreshScreen() {
    const boards = await loadTvBoards(gymId.value, TV_BOARD_ROWS).catch(
        () => null,
    )
    if (boards) boardData.value = boards
}

let rotateTimer: ReturnType<typeof setTimeout> | undefined
const rotation = ref(0)
function scheduleRotation() {
    clearTimeout(rotateTimer)
    if (takeover.value || playlist.value.length < 2) return
    rotation.value++
    rotateTimer = setTimeout(
        () => {
            slideIndex.value = (slideIndex.value + 1) % playlist.value.length
            scheduleRotation()
        },
        slideSeconds(slide.value, screen.value) * 1000,
    )
}

let refreshing = false
const portraitQuery = shallowRef<MediaQueryList>()
const updateOrientation = () =>
    (orientation.value = portraitQuery.value?.matches
        ? 'portrait'
        : 'landscape')
useEventListener(portraitQuery, 'change', updateOrientation)
const { resume: startClock } = useIntervalFn(
    () => (now.value = new Date()),
    CLOCK_MS,
    { immediate: false },
)
const { resume: startRefresh } = useIntervalFn(
    async () => {
        if (refreshing) return
        refreshing = true
        await refreshScreen().finally(() => (refreshing = false))
    },
    REFRESH_MS,
    { immediate: false },
)

watch(
    slideUrl,
    async (url) => {
        if (import.meta.server || qrCodes.value[url]) return
        qrCodes.value = { ...qrCodes.value, [url]: await qrDataUrl(url) }
    },
    { immediate: true },
)

onMounted(() => {
    now.value = new Date()
    portraitQuery.value = matchMedia('(orientation: portrait)')
    updateOrientation()
    startClock()
    startRefresh()
    watch(
        [
            () => playlist.value.length,
            () => takeover.value?.id,
            () => screen.value.seconds,
        ],
        scheduleRotation,
        { immediate: true },
    )
})
onBeforeUnmount(() => clearTimeout(rotateTimer))
</script>

<style scoped>
.tv-progress {
    animation: tv-progress linear forwards;
}

@keyframes tv-progress {
    from {
        width: 0;
    }
    to {
        width: 100%;
    }
}
</style>
