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
    const pb = usePocketbase()
    const subscribed: Promise<() => Promise<void>>[] = []
    const release = (subscription: Promise<() => Promise<void>>) =>
        void subscription.then((unsubscribe) => unsubscribe()).catch(() => {})

    onMounted(() => {
        subscribed.push(
            pb.realtime.subscribe('PB_CONNECT', () =>
                onChange({
                    competition: competitionId.value,
                    kind: 'resync',
                    at: Date.now(),
                }),
            ),
        )
        watch(
            competitionId,
            (id, _, onCleanup) => {
                const subscription = pb.realtime.subscribe(
                    competitionTopic(id),
                    (change: CompetitionChange) => {
                        if (change.competition === competitionId.value)
                            onChange(change)
                    },
                )
                subscription.catch(() => {})
                onCleanup(() => release(subscription))
            },
            { immediate: true },
        )
    })

    onBeforeUnmount(() => subscribed.forEach(release))
}
