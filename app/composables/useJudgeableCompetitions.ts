import type { CompetitionRecord } from '~/types/models'

export function useJudgeableCompetitions() {
    const pb = usePocketbase()
    const gymId = useCurrentGymId()

    return useAsyncData(
        'judge-competitions',
        () =>
            pb.collection('competitions').getFullList<CompetitionRecord>({
                filter: gymFilter(
                    pb,
                    gymId.value,
                    '(status = "open" || status = "closed")',
                ),
                sort: 'starts_at',
            }),
        { default: () => [] },
    )
}
