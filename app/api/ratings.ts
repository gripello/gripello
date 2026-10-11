import type { BetaVideoRecord, RatingRecord } from '../../types/models'
import type { Contribution } from '../utils/timeline'
import { toFormData, useApi } from './client'
import type { PageQuery, PbReadOptions, RouteList } from './client'

export type RatingSort = 'newest' | 'oldest' | 'highest' | 'lowest'

export interface RatingQuery {
    route?: string | string[]
    location?: string
    grade_system?: string
    grade?: string
    rating?: number
    min_rating?: number
    max_rating?: number
    since?: Date | string
    q?: string
    ids?: string[]
    include?: string[]
    sort?: RatingSort
    page?: number
    limit?: number
    total?: boolean
}

export type RatingInput = Partial<
    Pick<
        RatingRecord,
        'id' | 'rating' | 'comment' | 'grade' | 'grade_system' | 'grade_index'
    >
>

export interface RatingStats {
    total_reviews: number
    avg_rating: number | null
    low_rated: number
    this_week: number
}

export type BetaSource = { url: string } | { file: File }

const MAX_LIMIT = 500

const commaList = (values?: string | string[]) =>
    Array.isArray(values) ? values.join(',') : values

export function listRouteRatings<T = RatingRecord>(
    routeId: string,
    query: PageQuery = {},
): Promise<RouteList<T>> {
    return useApi()<RouteList<T>>(`/routes/${routeId}/ratings`, {
        query: { page: query.page, limit: query.limit ?? MAX_LIMIT },
    })
}

export async function listGymRatings<T = RatingRecord>(
    gym: string,
    query: RatingQuery = {},
    _options: PbReadOptions = {},
): Promise<RouteList<T>> {
    if (query.ids?.length === 0 || query.route?.length === 0)
        return { items: [], page: 1, limit: query.limit ?? 50 }
    const { include: _include, ids, route, since, total, ...filters } = query
    return useApi()<RouteList<T>>(`/gyms/${gym}/ratings`, {
        query: {
            ...filters,
            route: commaList(route),
            ids: commaList(ids),
            since: since ? new Date(since).toISOString() : undefined,
            total: total ? 'true' : undefined,
        },
    })
}

export function getRatingStats(gym: string, _requestKey?: string) {
    return useApi()<RatingStats>(`/gyms/${gym}/ratings/stats`)
}

export function createRating(
    routeId: string,
    { id: _id, ...input }: RatingInput,
    headers?: Record<string, string>,
) {
    return useApi()<RatingRecord>(`/routes/${routeId}/ratings`, {
        method: 'POST',
        body: input,
        headers,
    })
}

export function updateRating(id: string, { id: _id, ...patch }: RatingInput) {
    return useApi()<RatingRecord>(`/ratings/${id}`, {
        method: 'PATCH',
        body: patch,
    })
}

export function deleteRating(id: string) {
    return useApi()(`/ratings/${id}`, { method: 'DELETE' })
}

export function importRatings(gym: string, ratings: object[]) {
    return useApi()<{ failed: number }>(`/gyms/${gym}/ratings/import`, {
        method: 'POST',
        body: { ratings },
    })
}

export function listContributions() {
    return useApi()<{ reviews: Contribution[]; betas: Contribution[] }>(
        '/me/contributions',
    )
}

export async function listBetas(routeId: string) {
    const { items } = await useApi()<{ items: BetaVideoRecord[] }>(
        `/routes/${routeId}/betas`,
    )
    return items
}

export function listGymBetas<T = BetaVideoRecord>(
    gym: string,
    query: PageQuery & { include?: string[] } = {},
): Promise<RouteList<T>> {
    return useApi()<RouteList<T>>(`/gyms/${gym}/betas`, {
        query: {
            include: query.include?.join(',') || undefined,
            page: query.page,
            limit: query.limit ?? MAX_LIMIT,
        },
    })
}

export function createBeta(routeId: string, source: BetaSource) {
    return useApi()<BetaVideoRecord | { pending: true }>(
        `/routes/${routeId}/betas`,
        {
            method: 'POST',
            body: 'url' in source ? source : toFormData(source),
        },
    )
}

export function deleteBeta(id: string) {
    return useApi()(`/betas/${id}`, { method: 'DELETE' })
}
