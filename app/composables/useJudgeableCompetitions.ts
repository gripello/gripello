import { listCompetitions } from '~/api/competitions'

export function useJudgeableCompetitions() {
    const gymId = useCurrentGymId()

    const judgeable = useAsyncData(
        'judge-competitions',
        () => listCompetitions(gymId.value, { status: ['open', 'closed'] }),
        { default: () => [] },
    )
    useGymCompetitionsLive(judgeable.refresh)
    return judgeable
}
