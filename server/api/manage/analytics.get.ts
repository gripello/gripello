import { createError, eventHandler, getQuery } from 'h3'
import { fetchAll, requirePermission } from '../../utils/api-server'
import {
    buildAnalytics,
    resolveFilters,
    type AnalyticsQuery,
    type AnalyticsRating,
    type AnalyticsRoute,
} from '#shared/utils/analytics'
import { locationName } from '#shared/utils/formatting'
import type { RatingRecord, RouteRecord } from '../../../types/models'

export default eventHandler(async (event) => {
    const query = getQuery(event)
    const gym = typeof query.gym === 'string' ? query.gym : ''
    const api = await requirePermission(event, 'view_analytics', gym)
    const filters = resolveFilters(query as AnalyticsQuery)

    try {
        const [routes, ratings] = await Promise.all([
            fetchAll<RouteRecord>(
                api,
                `/gyms/${gym}/routes`,
                { archived: 'all', include: 'location' },
                1000,
            ),
            fetchAll<RatingRecord>(api, `/gyms/${gym}/ratings`, {}, 500),
        ])

        return buildAnalytics(
            routes.map((route): AnalyticsRoute => ({
                ...route,
                locationName: locationName(route) || null,
            })),
            ratings as AnalyticsRating[],
            filters,
        )
    } catch (error: any) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Failed to load analytics data',
            data: { message: error?.message || 'Unknown error' },
        })
    }
})
