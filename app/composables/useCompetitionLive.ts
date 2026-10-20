import { competitionTopic, gymCompetitionsTopic } from '#shared/utils/topics'
export interface CompetitionChange {
    competition: string
    gym?: string
    kind:
        | 'competition'
        | 'routes'
        | 'categories'
        | 'entries'
        | 'scores'
        | 'resync'
    user?: string
    entry?: string
    at: number
}

// Lists of a gym's competitions reload when one is created, changes status or is deleted.
export function useGymCompetitionsLive(refresh: () => Promise<unknown>) {
    const gymId = useCurrentGymId()
    return useLiveRefresh(() => gymCompetitionsTopic(gymId.value), refresh)
}

export function useCompetitionLive(
    competitionId: Ref<string>,
    onChange: (change: CompetitionChange) => void,
) {
    let stopResync: (() => void) | undefined
    let connectedBefore = false
    onMounted(() => {
        stopResync = onConnect((afterDrop) => {
            // the first connect covers what changed since the page rendered
            if (connectedBefore && !afterDrop) return
            connectedBefore = true
            onChange({
                competition: competitionId.value,
                kind: 'resync',
                at: Date.now(),
            })
        })
    })
    onBeforeUnmount(() => stopResync?.())

    useRealtime(
        () =>
            competitionId.value ? competitionTopic(competitionId.value) : null,
        (change: CompetitionChange) => {
            if (change.competition === competitionId.value) onChange(change)
        },
    )
}
