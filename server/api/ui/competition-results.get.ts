import { createError, eventHandler, getHeader, getQuery } from 'h3'
import {
    createPocketBase,
    getAuthenticatedPb,
    requirePermission,
} from '../../utils/pb-server'
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
        const { gym } = await getAuthenticatedPb(event)
            .collection('competitions')
            .getOne<CompetitionRecord>(id, { fields: 'gym', requestKey: null })
        return await requirePermission(event, 'manage_competitions', gym ?? '')
    } catch {
        return null
    }
}

export default eventHandler(async (event) => {
    const query = getQuery(event)
    const id = String(query.id ?? '')
    const changedAt = Number(query.since) || 0
    if (!id) {
        throw createError({ statusCode: 400, statusMessage: 'Missing id.' })
    }

    const staffPb = await staffClient(event, id)
    const cached = publicCache.get(id)
    if (
        !staffPb &&
        cached &&
        cachedResultsUsable(cached.at, Date.now(), changedAt)
    ) {
        return cached.results
    }
    const pb = staffPb ?? createPocketBase()
    const competition = await pb
        .collection('competitions')
        .getOne<CompetitionRecord>(id, { requestKey: null })
        .catch(() => {
            throw createError({ statusCode: 404, statusMessage: 'Not found.' })
        })

    if (staffPb) return loadResults(staffPb, competition, true)

    const results = loadResults(pb, competition, false)
    publicCache.set(id, { at: Date.now(), results })
    results.catch(() => publicCache.delete(id))
    return results
})
