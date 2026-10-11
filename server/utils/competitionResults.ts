import {
    buildStandings,
    type CompetitionResults,
    type ResultsInput,
} from '#shared/utils/competitionResults'
import type { CompetitionRecord } from '../../types/models'
import type { Api } from './api-server'

export async function loadResults(
    api: Api,
    id: string,
): Promise<CompetitionResults> {
    const { visibility, ...input } = await api<
        ResultsInput & {
            visibility: CompetitionResults['visibility']
            competition: CompetitionRecord
        }
    >(`/competitions/${id}/results`)
    return {
        visibility,
        format: input.competition.scoring_format,
        updated: new Date().toISOString(),
        categories:
            visibility === 'hidden' || visibility === 'frozen'
                ? []
                : buildStandings(input),
    }
}

export const PUBLIC_RESULTS_CACHE_MS = 5_000
export const MIN_RECOMPUTE_MS = 1_000

export function cachedResultsUsable(
    cachedAt: number,
    now: number,
    changedAt: number,
) {
    const age = now - cachedAt
    if (age < MIN_RECOMPUTE_MS) return true
    const outdatedByChange = changedAt > cachedAt && changedAt <= now
    return age < PUBLIC_RESULTS_CACHE_MS && !outdatedByChange
}
