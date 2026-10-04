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

const COMPETITION_TOPIC = 'competition_changes'

export function useCompetitionLive(
    competitionId: Ref<string>,
    onChange: (change: CompetitionChange) => void,
) {
    const pb = usePocketbase()
    const unsubscribers: (() => Promise<void>)[] = []
    let unmounted = false

    const keep = (unsubscribe: () => Promise<void>) => {
        if (unmounted) void unsubscribe().catch(() => {})
        else unsubscribers.push(unsubscribe)
    }

    onMounted(async () => {
        try {
            keep(
                await pb.realtime.subscribe(
                    COMPETITION_TOPIC,
                    (change: CompetitionChange) => {
                        if (change.competition === competitionId.value) {
                            onChange(change)
                        }
                    },
                ),
            )
            keep(
                await pb.realtime.subscribe('PB_CONNECT', () =>
                    onChange({
                        competition: competitionId.value,
                        kind: 'resync',
                        at: Date.now(),
                    }),
                ),
            )
        } catch {}
    })

    onBeforeUnmount(() => {
        unmounted = true
        unsubscribers.forEach((unsubscribe) => unsubscribe().catch(() => {}))
    })
}
