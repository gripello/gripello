import { eventHandler, createError } from 'h3'
import { requirePermission } from '../../utils/api-server'
import {
    resolveRouteIds,
    resolveExportGymId,
    fetchRatingsByRoutes,
    fetchRoutesByIds,
} from '../../utils/export'
import {
    locationName,
    normalizeCreators,
    wallName,
} from '#shared/utils/formatting'
import type { RatingRecord, RouteRecord } from '../../../types/models'

export default eventHandler(async (event) => {
    const gymId = await resolveExportGymId(event)
    const api = await requirePermission(event, 'manage_routes', gymId)
    const ids = await resolveRouteIds(event)

    if (ids.length === 0) {
        throw createError({
            statusCode: 400,
            statusMessage: 'No IDs provided.',
        })
    }

    try {
        const uniqueIds = Array.from(new Set(ids))
        const routes = await fetchRoutesByIds(api, gymId, uniqueIds, [
            'location',
            'wall',
        ])
        const ratings = await fetchRatingsByRoutes(api, gymId, uniqueIds)

        const routeById = new Map<string, RouteRecord>()
        for (const route of routes) {
            routeById.set(route.id, route)
        }

        const ratingsByRouteId = new Map<
            string,
            ReturnType<typeof mapRating>[]
        >()
        for (const rating of ratings) {
            if (!rating.route_id) {
                continue
            }
            const routeRatings = ratingsByRouteId.get(rating.route_id) ?? []
            routeRatings.push(mapRating(rating))
            ratingsByRouteId.set(rating.route_id, routeRatings)
        }

        const payload = []
        for (const id of uniqueIds) {
            const route = routeById.get(id)
            if (!route) {
                continue
            }
            payload.push(mapRoute(route, ratingsByRouteId.get(id) ?? []))
        }

        return payload
    } catch (error) {
        console.error('Failed to export routes as JSON:', error)
        throw createError({
            statusCode: 500,
            statusMessage: 'Failed to export routes as JSON',
        })
    }
})

function mapRoute(
    route: RouteRecord & { score?: number | null },
    ratings: ReturnType<typeof mapRating>[],
) {
    return {
        id: route.id ?? null,
        name: route.name ?? '',
        color: route.color ?? null,
        grade: route.grade ?? '',
        grade_system: route.grade_system ?? null,
        anchor_point: normalizeNumber(route.anchor_point),
        location: locationName(route) || null,
        wall: wallName(route) || null,
        wall_position: normalizeNumber(route.wall_position),
        type: route.type ?? null,
        comment: route.comment ?? '',
        creator: normalizeCreators(route.creator),
        screw_date: route.screw_date ?? null,
        score: route.score ?? null,
        archived: Boolean(route.archived),
        created: route.created ?? null,
        updated: route.updated ?? null,
        ratings,
    }
}

function mapRating(rating: RatingRecord) {
    return {
        rating: normalizeNumber(rating.rating),
        grade: rating.grade ?? null,
        grade_system: rating.grade_system ?? null,
        comment: rating.comment ?? '',
        created: rating.created ?? null,
        updated: rating.updated ?? null,
    }
}

function normalizeNumber(value: unknown) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
}
