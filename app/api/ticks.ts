import type { SeasonRecord, TickRecord } from '../../types/models'
import type { FeedTick } from '../utils/friends'
import type { LogbookKind } from '../../shared/utils/logbook'
import { ROLLING_SEASON, type Leaderboard } from '../utils/leaderboard'
import { updatableFields } from '../utils/tickOutbox'
import { useApi } from './client'
import type { PageQuery, PbReadOptions, RouteList } from './client'

export interface OwnTickQuery extends PageQuery {
    route?: string
    since?: Date | string
    include?: string[]
    sort?: string
}

export interface FeedQuery extends PageQuery {
    gym?: string
    sort?: '-date' | '-created'
}

export type TickPatch = Partial<TickRecord>

export type SeasonInput = Pick<SeasonRecord, 'name' | 'starts_at' | 'ends_at'>

const MAX_LIMIT = 1000

async function readTicks<T>(
    path: string,
    query: PageQuery & Record<string, unknown>,
): Promise<RouteList<T>> {
    const { total, ...rest } = query
    const read = (page: number, limit: number) =>
        useApi()<RouteList<T>>(path, {
            query: { ...rest, page, limit, total: total ? 'true' : undefined },
        })
    if (query.page) return read(query.page, query.limit ?? 50)
    const items: T[] = []
    for (let page = 1; ; page++) {
        const result = await read(page, MAX_LIMIT)
        items.push(...result.items)
        if (result.items.length < MAX_LIMIT)
            return { items, page: 1, limit: items.length }
    }
}

export function listOwnTicks<T = TickRecord>(
    query: OwnTickQuery = {},
    _options: PbReadOptions = {},
): Promise<RouteList<T>> {
    const { include: _include, since, ...rest } = query
    return readTicks<T>('/me/ticks', {
        ...rest,
        since: since instanceof Date ? since.toISOString() : since,
    })
}

export function listSentRoutes() {
    return useApi()<string[]>('/me/ticks/sends')
}

export function createTick({
    id,
    user,
    route,
    type,
    attempts,
    date,
    note,
}: TickRecord) {
    return useApi()<TickRecord>('/me/ticks', {
        method: 'POST',
        body: { id, user, route, type, attempts, date, note },
    })
}

export function updateTick(id: string, patch: TickPatch) {
    return useApi()<TickRecord>(`/ticks/${id}`, {
        method: 'PATCH',
        body: updatableFields(patch as TickRecord),
    })
}

export function deleteTick(id: string) {
    return useApi()(`/ticks/${id}`, { method: 'DELETE' })
}

export function listFeed<T = FeedTick>(
    query: FeedQuery = {},
    _options: PbReadOptions = {},
): Promise<RouteList<T>> {
    return readTicks<T>('/me/feed', { ...query, sort: query.sort ?? '-date' })
}

export async function listClimberTicks<T = FeedTick>(id: string) {
    return (await readTicks<T>(`/climbers/${id}/ticks`, {})).items
}

export function getLeaderboard(
    gym: string,
    { kind, season }: { kind: LogbookKind; season: string },
) {
    return useApi()<Leaderboard>(`/gyms/${gym}/leaderboard`, {
        query: { kind, season: season === ROLLING_SEASON ? undefined : season },
    })
}

export function listSeasons(gym: string) {
    return useApi()<SeasonRecord[]>(`/gyms/${gym}/seasons`)
}

export function createSeason(gym: string, input: SeasonInput) {
    return useApi()<SeasonRecord>(`/gyms/${gym}/seasons`, {
        method: 'POST',
        body: input,
    })
}

export function updateSeason(id: string, patch: Partial<SeasonInput>) {
    return useApi()<SeasonRecord>(`/seasons/${id}`, {
        method: 'PATCH',
        body: patch,
    })
}

export function deleteSeason(id: string) {
    return useApi()(`/seasons/${id}`, { method: 'DELETE' })
}
