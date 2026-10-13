import { getCompetitionStandings } from '~/api/competitions'
import { keepWhenOffline } from '~/utils/errors'

const RESULT_KINDS = ['competition', 'routes', 'entries', 'scores', 'resync']
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
    const result = useAsyncData(
        key,
        (nuxtApp) =>
            keepWhenOffline(nuxtApp, key(), () =>
                getCompetitionStandings(
                    competitionId.value,
                    staff ? {} : { view: 'public' },
                ),
            ),
        { enabled: () => !!competitionId.value },
    )

    let liveRefresh: ReturnType<typeof setTimeout> | undefined
    useCompetitionLive(competitionId, (change) => {
        if (!RESULT_KINDS.includes(change.kind) || liveRefresh) return
        liveRefresh = setTimeout(
            () => {
                liveRefresh = undefined
                void result.refresh()
            },
            LIVE_REFRESH_DELAY_MS + Math.random() * LIVE_REFRESH_JITTER_MS,
        )
    })

    let timer: ReturnType<typeof setInterval> | undefined
    const poll = () => {
        if (document.visibilityState === 'visible' && navigator.onLine)
            void result.refresh()
    }
    onMounted(() => {
        timer = setInterval(poll, pollMs)
        document.addEventListener('visibilitychange', poll)
    })
    onBeforeUnmount(() => {
        clearInterval(timer)
        clearTimeout(liveRefresh)
        document.removeEventListener('visibilitychange', poll)
    })

    return result
}
