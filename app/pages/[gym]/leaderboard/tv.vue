<template>
    <TvShell
        :gym="gym"
        :qr="qrUrl"
        :qr-alt="t('leaderboard.title')"
        data-testid="leaderboard-tv"
    >
        <template #eyebrow>
            <p class="mb-1 text-xl text-muted">{{ seasonLabel }}</p>
        </template>
        <template #title>{{ t('leaderboard.title') }}</template>

        <div
            v-if="!columns.length"
            class="flex flex-1 flex-col items-center justify-center gap-6 text-center"
        >
            <UIcon name="i-lucide-medal" class="size-32 text-dimmed" />
            <p class="text-4xl font-semibold text-muted">
                {{ t('leaderboard.empty') }}
            </p>
        </div>

        <TvLeaderboard
            v-else
            :boards="columns"
            :rows="columns.length > 1 ? TV_BOARD_ROWS : TV_ROWS"
        />
    </TvShell>
</template>

<script setup lang="ts">
import { qrDataUrl } from '~/utils/qrDataUrl'
import { LEADERBOARD_REFRESH_MS, leaderboardTopic } from '~/utils/leaderboard'
import { TV_BOARD_ROWS } from '~/utils/tvScreen'

definePageMeta({ layout: false })

const TV_ROWS = 15
const REFRESH_MS = 60_000

const { t } = useI18n()
const gymId = useCurrentGymId()
const gymPath = useGymPath()
const { gym } = useGym()
const requestUrl = useRequestURL({
    xForwardedHost: true,
    xForwardedProto: true,
})

useHead({ title: t('page.title.leaderboard') })

const { data: boardData } = await useAsyncData(
    'leaderboard-tv',
    () => loadTvBoards(gymId.value, TV_ROWS),
    { default: () => ({ season: null, boards: [] }) },
)

async function refreshBoards() {
    try {
        boardData.value = await loadTvBoards(gymId.value, TV_ROWS)
    } catch {
        // the wall screen keeps the last good board through network blips
    }
}

useLiveRefresh(() => leaderboardTopic(gymId.value), refreshBoards, {
    delayMs: LEADERBOARD_REFRESH_MS,
})

const columns = computed(() =>
    boardData.value.boards.filter((column) => column.rows.length),
)
const seasonLabel = computed(
    () => boardData.value.season?.name ?? t('leaderboard.rolling'),
)

const qrUrl = ref('')
let refreshTimer: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
    refreshTimer = setInterval(() => void refreshBoards(), REFRESH_MS)
    qrUrl.value = await qrDataUrl(
        `${requestUrl.origin}${gymPath('/leaderboard')}`,
    )
})
onBeforeUnmount(() => clearInterval(refreshTimer))
</script>
