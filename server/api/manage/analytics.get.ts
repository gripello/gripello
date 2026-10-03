import { createError, eventHandler, getQuery } from 'h3'
import { requirePermission } from '../../utils/pb-server'
import {
    buildAnalytics,
    resolveFilters,
    type AnalyticsQuery,
    type AnalyticsRating,
    type AnalyticsRoute,
} from '#shared/utils/analytics'
import { locationName } from '#shared/utils/formatting'
import type { RatingRecord, RouteRecord } from '../../../types/models'

const ROUTE_FIELDS =
    'id,name,grade,grade_system,grade_index,type,location,creator,archived,archived_at,screw_date,created,expand.location.name'
const RATING_FIELDS =
    'id,route_id,rating,grade,grade_system,grade_index,comment,created'

export default eventHandler(async (event) => {
    const query = getQuery(event)
    const gym = typeof query.gym === 'string' ? query.gym : ''
    const pb = await requirePermission(event, 'view_analytics', gym)
    const filters = resolveFilters(query as AnalyticsQuery)
    const filter = pb.filter('gym = {:gym}', { gym })

    try {
        const [routes, ratings] = await Promise.all([
            pb.collection('routes').getFullList<RouteRecord>({
                batch: 500,
                filter,
                expand: 'location',
                fields: ROUTE_FIELDS,
                requestKey: null,
            }),
            pb.collection('ratings').getFullList<RatingRecord>({
                batch: 500,
                filter,
                fields: RATING_FIELDS,
                requestKey: null,
            }),
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
