import type {
    LocationRecord,
    RouteRecord,
    RouteScoreRecord,
    WallRecord,
} from '../../types/models'
import type { GymMap } from '../../shared/utils/mapGeometry'
import { useApi } from './client'
import type { PbReadOptions, RouteList } from './client'

export type RouteInclude = 'location' | 'wall' | 'gym'

export interface RouteQuery {
    archived?: boolean | 'all'
    location?: string
    wall?: string
    type?: string
    color?: string
    grade_system?: string
    grade?: string[]
    q?: string
    since?: Date | string
    ids?: string[]
    include?: RouteInclude[]
    sort?: string
    page?: number
    limit?: number
    total?: boolean
}

export type RouteInput = {
    [K in keyof Omit<RouteRecord, 'id'>]?: RouteRecord[K] | null
}

export interface RoutePlacement {
    route: string
    wall: string
    wall_position?: number | null
}

export type WallInput = Partial<Omit<WallRecord, 'id'>>

export interface FloorPlan {
    map: GymMap | null
    walls: (WallInput & { id?: string })[]
    removed?: string[]
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 1000
const MAX_IDS = 200

type Items<T> = { items: T[] }

function routeParams(query: RouteQuery) {
    const since =
        query.since instanceof Date ? query.since.toISOString() : query.since
    return {
        archived:
            query.archived === undefined ? undefined : String(query.archived),
        location: query.location || undefined,
        wall: query.wall || undefined,
        type: query.type || undefined,
        color: query.color || undefined,
        grade_system: query.grade_system || undefined,
        grade: query.grade,
        q: query.q || undefined,
        since: since || undefined,
        ids: query.ids?.join(','),
        include: query.include?.length ? query.include.join(',') : undefined,
        sort: query.sort || undefined,
    }
}

function chunks<T>(list: T[], size: number) {
    return Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
        list.slice(i * size, (i + 1) * size),
    )
}

async function listByIds<T>(
    path: string,
    ids: string[],
    query: Record<string, string | undefined> = {},
) {
    const api = useApi()
    const pages = await Promise.all(
        chunks(ids, MAX_IDS).map((chunk) =>
            api<Items<T>>(path, { query: { ...query, ids: chunk.join(',') } }),
        ),
    )
    return pages.flatMap((page) => page.items)
}

export async function listRoutes<T = RouteScoreRecord>(
    gym: string | null,
    query: RouteQuery = {},
    _options: PbReadOptions = {},
): Promise<RouteList<T>> {
    if (query.ids?.length === 0 || query.grade?.length === 0)
        return { items: [], page: 1, limit: query.limit ?? DEFAULT_LIMIT }
    if (gym === null) {
        if (!query.ids) throw new Error('listRoutes needs a gym or ids')
        const items = await listByIds<T>('/routes', query.ids, {
            include: query.include?.length
                ? query.include.join(',')
                : undefined,
        })
        return { items, page: 1, limit: items.length }
    }
    const api = useApi()
    const path = `/gyms/${encodeURIComponent(gym)}/routes`
    const params = routeParams(query)
    if (query.page) {
        const limit = query.limit ?? DEFAULT_LIMIT
        return api<RouteList<T>>(path, {
            query: {
                ...params,
                page: query.page,
                limit,
                total: query.total ? 'true' : undefined,
            },
        })
    }
    const items: T[] = []
    for (let page = 1; ; page++) {
        const result = await api<RouteList<T>>(path, {
            query: { ...params, page, limit: MAX_LIMIT },
        })
        items.push(...result.items)
        if (result.items.length < MAX_LIMIT) break
    }
    return { items, page: 1, limit: items.length }
}

export function getRoute<T = RouteRecord>(
    id: string,
    include: RouteInclude[] = [],
    _options: PbReadOptions = {},
) {
    return useApi()<T>(`/routes/${encodeURIComponent(id)}`, {
        query: include.length ? { include: include.join(',') } : undefined,
    })
}

export function createRoute(gym: string, input: RouteInput) {
    return useApi()<RouteRecord>(`/gyms/${encodeURIComponent(gym)}/routes`, {
        method: 'POST',
        body: input,
    })
}

export function updateRoute(id: string, patch: RouteInput) {
    return useApi()<RouteRecord>(`/routes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
    })
}

export async function deleteRoute(id: string, force = false) {
    await useApi()(`/routes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        query: force ? { force: 'true' } : undefined,
    })
    return true
}

export function archiveRoute(id: string, archived = true) {
    return useApi()<RouteRecord>(`/routes/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        body: { archived },
    })
}

export async function archiveRoutes(
    gym: string,
    ids: string[],
    archived = true,
) {
    if (!ids.length) return
    await useApi()(`/gyms/${encodeURIComponent(gym)}/routes/archive`, {
        method: 'POST',
        body: { ids, archived },
    })
}

export async function placeRoutes(gym: string, placements: RoutePlacement[]) {
    if (!placements.length) return
    await useApi()(`/gyms/${encodeURIComponent(gym)}/map/placements`, {
        method: 'PUT',
        body: { placements },
    })
}

export async function listRouteColors(gym: string) {
    const { items } = await useApi()<Items<string>>(
        `/gyms/${encodeURIComponent(gym)}/routes/colors`,
    )
    return items.filter(Boolean)
}

export async function listLocations(gym: string, _options: PbReadOptions = {}) {
    const { items } = await useApi()<Items<LocationRecord>>(
        `/gyms/${encodeURIComponent(gym)}/locations`,
    )
    return items
}

export function createLocation(gym: string, input: { name: string }) {
    return useApi()<LocationRecord>(
        `/gyms/${encodeURIComponent(gym)}/locations`,
        { method: 'POST', body: input },
    )
}

export function updateLocation(id: string, patch: Partial<LocationRecord>) {
    return useApi()<LocationRecord>(`/locations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
    })
}

export async function deleteLocation(id: string) {
    await useApi()(`/locations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    })
    return true
}

export function uploadMapTrace(id: string, file: File) {
    const body = new FormData()
    body.append('map_trace', file)
    return useApi()<LocationRecord>(
        `/locations/${encodeURIComponent(id)}/map-trace`,
        { method: 'PUT', body },
    )
}

export function deleteMapTrace(id: string) {
    return useApi()<LocationRecord>(
        `/locations/${encodeURIComponent(id)}/map-trace`,
        { method: 'DELETE' },
    )
}

export function saveFloorPlan(locationId: string, plan: FloorPlan) {
    return useApi()<{ location: LocationRecord; walls: WallRecord[] }>(
        `/locations/${encodeURIComponent(locationId)}/floor-plan`,
        {
            method: 'PUT',
            body: {
                map: plan.map,
                walls: plan.walls,
                removed: plan.removed ?? [],
            },
        },
    )
}

export async function listWalls<T = WallRecord>(
    gym: string,
    query: { location?: string } = {},
    _options: PbReadOptions = {},
) {
    const { items } = await useApi()<Items<T>>(
        `/gyms/${encodeURIComponent(gym)}/walls`,
        { query: query.location ? { location: query.location } : undefined },
    )
    return items
}

export async function listWallsByIds<
    T = WallRecord & { location_name: string },
>(ids: string[]) {
    if (!ids.length) return [] as T[]
    return listByIds<T>('/walls', ids)
}
