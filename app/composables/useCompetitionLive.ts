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

export const competitionTopic = (competitionId: string) =>
    `competition_changes:${competitionId}`

export function useCompetitionLive(
    competitionId: Ref<string>,
    onChange: (change: CompetitionChange) => void,
) {
    let stopResync: (() => void) | undefined
    onMounted(() => {
        stopResync = onConnect(() =>
            onChange({
                competition: competitionId.value,
                kind: 'resync',
                at: Date.now(),
            }),
        )
    })
    onBeforeUnmount(() => stopResync?.())

    useRealtime(
        () => competitionTopic(competitionId.value),
        (change: CompetitionChange) => {
            if (change.competition === competitionId.value) onChange(change)
        },
    )
}
