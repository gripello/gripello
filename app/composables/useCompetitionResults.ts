import { useEventListener, useIntervalFn, useTimeoutFn } from '@vueuse/core'
import { getCompetitionStandings } from '~/api/competitions'
import { useOfflineData } from '~/composables/useOfflineData'

const RESULT_KINDS = [
    'competition',
    'routes',
    'categories',
    'entries',
    'scores',
    'resync',
]
// Later than nginx's shared 1 s standings cache can live (up to 2 s), so a refetch never gets the pre-change copy.
const LIVE_REFRESH_DELAY_MS = 2_000
const LIVE_REFRESH_JITTER_MS = 2_000

export function useCompetitionResults(
    competitionId: Ref<string>,
    {
        staff = false,
        pollMs = 60_000,
    }: { staff?: boolean; pollMs?: number } = {},
) {
    const key = () =>
        `competition-results:${staff ? 'staff' : 'public'}:${competitionId.value}`
    const result = useOfflineData(
        key,
        () =>
            getCompetitionStandings(
                competitionId.value,
                staff ? {} : { view: 'public' },
            ),
        { enabled: () => !!competitionId.value },
    )

    const liveRefresh = useTimeoutFn(
        () => void result.refresh(),
        () => LIVE_REFRESH_DELAY_MS + Math.random() * LIVE_REFRESH_JITTER_MS,
        { immediate: false },
    )
    useCompetitionLive(competitionId, (change) => {
        if (!RESULT_KINDS.includes(change.kind) || liveRefresh.isPending.value)
            return
        liveRefresh.start()
    })

    const poll = () => {
        if (document.visibilityState === 'visible' && navigator.onLine)
            void result.refresh()
    }
    const { resume: startPolling } = useIntervalFn(poll, pollMs, {
        immediate: false,
    })
    onMounted(() => {
        startPolling()
        useEventListener(document, 'visibilitychange', poll)
    })

    return result
}
