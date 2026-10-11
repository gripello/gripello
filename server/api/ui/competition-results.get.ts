import { createError, eventHandler, getHeader, getQuery } from 'h3'
import { apiFetch, requirePermission } from '../../utils/api-server'
import {
    cachedResultsUsable,
    loadResults,
} from '../../utils/competitionResults'
import type { CompetitionResults } from '#shared/utils/competitionResults'
import type { CompetitionRecord } from '../../../types/models'

const publicCache = new Map<
    string,
    { at: number; results: Promise<CompetitionResults> }
>()

async function staffClient(event: Parameters<typeof getHeader>[0], id: string) {
    if (!getHeader(event, 'authorization')) return null
    try {
        const { gym } = await apiFetch(event)<CompetitionRecord>(
            `/competitions/${id}`,
        )
        return await requirePermission(event, 'manage_competitions', gym ?? '')
    } catch {
        return null
    }
}

function notFound(): never {
    throw createError({ statusCode: 404, statusMessage: 'Not found.' })
}

export default eventHandler(async (event) => {
    const query = getQuery(event)
    const id = String(query.id ?? '')
    const changedAt = Number(query.since) || 0
    if (!id) {
        throw createError({ statusCode: 400, statusMessage: 'Missing id.' })
    }

    const staffApi = await staffClient(event, id)
    if (staffApi) return loadResults(staffApi, id).catch(notFound)

    const cached = publicCache.get(id)
    if (cached && cachedResultsUsable(cached.at, Date.now(), changedAt)) {
        return cached.results
    }
    const results = loadResults(apiFetch(), id)
    publicCache.set(id, { at: Date.now(), results })
    results.catch(() => publicCache.delete(id))
    return results.catch(notFound)
})
