import type { CompetitionResults } from '#shared/utils/competitionResults'
import { resultsChangedAt } from '~/utils/competitions'

const RESULT_KINDS = ['competition', 'routes', 'entries', 'scores', 'resync']

export function useCompetitionResults(
    competitionId: Ref<string>,
    {
        staff = false,
        pollMs = 60_000,
    }: { staff?: boolean; pollMs?: number } = {},
) {
    const pb = usePocketbase()
    const requestFetch = useRequestFetch()
    const changedAt = ref(0)

    const result = useAsyncData(
        () =>
            `competition-results:${staff ? 'staff' : 'public'}:${competitionId.value}`,
        () =>
            requestFetch<CompetitionResults>('/api/ui/competition-results', {
                query: {
                    id: competitionId.value,
                    since: changedAt.value || undefined,
                },
                headers:
                    staff && pb.authStore.token
                        ? { Authorization: pb.authStore.token }
                        : undefined,
            }),
        { enabled: () => !!competitionId.value },
    )

    const refreshSoon = coalesce(() => result.refresh(), 1_000)
    useCompetitionLive(competitionId, (change) => {
        if (!RESULT_KINDS.includes(change.kind)) return
        changedAt.value = resultsChangedAt(changedAt.value, change)
        refreshSoon()
    })

    let timer: ReturnType<typeof setInterval> | undefined
    const poll = () => {
        if (document.visibilityState === 'visible') void result.refresh()
    }
    onMounted(() => {
        timer = setInterval(poll, pollMs)
        document.addEventListener('visibilitychange', poll)
    })
    onBeforeUnmount(() => {
        clearInterval(timer)
        document.removeEventListener('visibilitychange', poll)
    })

    return result
}
