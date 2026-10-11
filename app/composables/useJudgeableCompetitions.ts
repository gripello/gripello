import { listCompetitions } from '~/api/competitions'

export function useJudgeableCompetitions() {
    const gymId = useCurrentGymId()

    return useAsyncData(
        'judge-competitions',
        () => listCompetitions(gymId.value, { status: ['open', 'closed'] }),
        { default: () => [] },
    )
}
