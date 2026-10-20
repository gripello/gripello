import { getCompetition } from '~/api/competitions'
import { coalesce } from '~/utils/realtimeCache'
import { useOfflineData } from '~/composables/useOfflineData'
import type { CompetitionChange } from '~/composables/useCompetitionLive'

export function useCompetitionRecord(
    onChange: (change: CompetitionChange) => void = () => {},
) {
    const route = useRoute()
    const gymId = useCurrentGymId()
    const competitionId = computed(() =>
        String((route.params as { id?: string }).id ?? ''),
    )
    const request = useOfflineData(
        () => `competition:${competitionId.value}`,
        () => getCompetition(competitionId.value),
        { enabled: () => !!competitionId.value },
    )
    const refreshSoon = coalesce(() => request.refresh(), 300)
    useCompetitionLive(competitionId, (change) => {
        if (change.kind === 'competition' || change.kind === 'resync')
            refreshSoon()
        onChange(change)
    })
    const loaded = request.then((result) => {
        if (result.data.value && result.data.value.gym !== gymId.value)
            throw createError({ status: 404, fatal: true })
        return { ...result, competitionId }
    })
    const { data, status, error, pending, refresh, execute, clear } = request
    return Object.assign(loaded, {
        data,
        status,
        error,
        pending,
        refresh,
        execute,
        clear,
        competitionId,
    })
}
