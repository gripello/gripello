import { normalizeCreators, parseDate } from './formatting'
import {
    gradeIndex,
    compareGradeKeys,
    gradeKey,
    isGradeSystem,
    nearestGrade,
    type GradeSource,
} from './grades'

export const ANALYTICS_RANGES = ['30d', '90d', '12m', 'all', 'custom'] as const
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]

export const MIN_VOTES_FOR_FEEDBACK = 3
export const GRADE_DEVIATION_THRESHOLD = 1.5
const LIST_LIMIT = 5
const OLDEST_LIMIT = 10
const FEEDBACK_LIMIT = 300
const DAY_MS = 86_400_000

export interface AnalyticsRoute extends GradeSource {
    id: string
    name?: string | null
    type?: string | null
    location?: string | null
    locationName?: string | null
    creator?: unknown
    archived?: boolean
    archived_at?: string | null
    permanent?: boolean
    screw_date?: string | null
    created?: string
}

export interface AnalyticsRating extends GradeSource {
    id: string
    route_id?: string | null
    rating?: number | null
    comment?: string | null
    created?: string
}

export interface AnalyticsQuery {
    range?: string
    from?: string
    to?: string
    location?: string
    type?: string
    archived?: string
}

export interface AnalyticsFilters {
    from: Date | null
    to: Date
    locations: string[]
    types: string[]
    includeArchived: boolean
}

export interface Trend {
    value: number
    previous: number | null
}

export interface TimelineDatum {
    period: string
    count: number
}

export interface GradeDatum {
    grade: string
    total: number
    expected: number
}

export interface RouteSummary {
    id: string
    name: string
    grade: string
    type: string | null
    location: string | null
    creators: string[]
    screwDate: string | null
}

export interface RatedRoute extends RouteSummary {
    averageRating: number
    ratings: number
}

export interface FeedbackRoute extends RouteSummary {
    setGrade: number
    votedGrade: number
    votedGradeLabel: string
    deviation: number
    votes: number
}

export interface SetterStats {
    setter: string
    routes: number
    routesInPeriod: number
    averageRating: number | null
    averageDeviation: number | null
}

export interface AgedRoute extends RouteSummary {
    ageDays: number
}

export interface LocationGradeDatum {
    location: string
    grade: string
    count: number
}

export interface LatestComment {
    id: string
    routeId: string | null
    routeName: string
    rating: number | null
    comment: string
    created: string | null
}

export const DISCIPLINES = ['Boulder', 'Route'] as const
export type Discipline = (typeof DISCIPLINES)[number]

export interface GradeAnalytics {
    gradeDistribution: GradeDatum[]
    locationGrades: LocationGradeDatum[]
    gradeFeedback: FeedbackRoute[]
}

export function disciplineOf(route: { type?: string | null }): Discipline {
    return route.type === 'Boulder' ? 'Boulder' : 'Route'
}

export interface AnalyticsResponse {
    generatedAt: string
    period: { from: string | null; to: string }
    bucket: Bucket
    summary: {
        activeRoutes: number
        routesSet: Trend
        ratings: Trend
        averageRating: Trend
        comments: Trend
        averageLifespanDays: number | null
        unratedRoutes: number
    }
    grades: Record<Discipline, GradeAnalytics>
    routeTimeline: TimelineDatum[]
    ratingTimeline: TimelineDatum[]
    commentTimeline: TimelineDatum[]
    dailyRouteActivity: TimelineDatum[]
    ratingDistribution: number[]
    setters: SetterStats[]
    ratingBaseline: number | null
    topRated: RatedRoute[]
    lowestRated: RatedRoute[]
    oldestActive: AgedRoute[]
    latestComments: LatestComment[]
}

function splitList(raw: string | undefined): string[] {
    return (raw ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
}

function startOfDay(date: Date) {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    )
}

function endOfDay(date: Date) {
    return new Date(startOfDay(date).getTime() + DAY_MS - 1)
}

export function resolveFilters(
    query: AnalyticsQuery,
    now = new Date(),
): AnalyticsFilters {
    const range = ANALYTICS_RANGES.includes(query.range as AnalyticsRange)
        ? (query.range as AnalyticsRange)
        : '90d'
    const presetDays: Partial<Record<AnalyticsRange, number>> = {
        '30d': 30,
        '90d': 90,
        '12m': 365,
    }

    let from: Date | null = null
    let to = now
    if (range === 'custom') {
        const customFrom = parseDate(query.from)
        const customTo = parseDate(query.to)
        from = customFrom ? startOfDay(customFrom) : null
        to = customTo ? endOfDay(customTo) : now
        if (from && from > to) [from, to] = [startOfDay(to), endOfDay(from)]
    } else if (presetDays[range]) {
        from = new Date(now.getTime() - presetDays[range]! * DAY_MS)
    }

    return {
        from,
        to,
        locations: splitList(query.location),
        types: splitList(query.type),
        includeArchived: query.archived === 'true',
    }
}

export function gradeScore(source: GradeSource): number | null {
    const storedIndex = source.grade_index
    const index =
        typeof storedIndex === 'number' && storedIndex > 0
            ? storedIndex
            : gradeIndex(source.grade_system, source.grade)
    return typeof index === 'number' && Number.isFinite(index) ? index : null
}

export function compareGrades(left: string, right: string): number {
    return compareGradeKeys(left, right) || left.localeCompare(right)
}

function routeDate(route: AnalyticsRoute): Date | null {
    return parseDate(route.screw_date) ?? parseDate(route.created)
}

function inPeriod(date: Date | null, from: Date | null, to: Date) {
    return !!date && (!from || date >= from) && date <= to
}

function mean(values: number[]): number | null {
    return values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null
}

function round(value: number | null, digits = 2): number | null {
    return value === null ? null : Number(value.toFixed(digits))
}

function increase(map: Map<string, number>, key: string, by = 1) {
    map.set(key, (map.get(key) ?? 0) + by)
}

export type Bucket = 'day' | 'week' | 'month'

function bucketKey(date: Date, bucket: Bucket) {
    if (bucket === 'month') return date.toISOString().slice(0, 7)
    const day = startOfDay(date)
    if (bucket === 'week') {
        day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
    }
    return day.toISOString().slice(0, 10)
}

function fillBuckets(
    map: Map<string, number>,
    start: Date | null,
    end: Date,
    bucket: Bucket,
): TimelineDatum[] {
    const first = start ? bucketKey(start, bucket) : [...map.keys()].sort()[0]
    if (!first) return []
    const last = bucketKey(end, bucket)
    const cursor = new Date(
        `${first}${bucket === 'month' ? '-01' : ''}T00:00:00Z`,
    )
    const result: TimelineDatum[] = []
    for (let key = first; key <= last; key = bucketKey(cursor, bucket)) {
        result.push({ period: key, count: map.get(key) ?? 0 })
        if (bucket === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1)
        else
            cursor.setUTCDate(cursor.getUTCDate() + (bucket === 'week' ? 7 : 1))
    }
    return result
}

function toTimeline(map: Map<string, number>): TimelineDatum[] {
    return [...map.entries()]
        .map(([period, count]) => ({ period, count }))
        .sort((a, b) => a.period.localeCompare(b.period))
}

function summarize(route: AnalyticsRoute, withSystem: boolean): RouteSummary {
    return {
        id: route.id,
        name: String(route.name ?? ''),
        grade: gradeKey(route, withSystem),
        type: route.type ?? null,
        location: route.locationName || null,
        creators: normalizeCreators(route.creator),
        screwDate: route.screw_date || route.created || null,
    }
}

export function buildAnalytics(
    allRoutes: AnalyticsRoute[],
    allRatings: AnalyticsRating[],
    filters: AnalyticsFilters,
    now = new Date(),
): AnalyticsResponse {
    const withSystem =
        new Set(allRoutes.map((route) => route.grade_system).filter(Boolean))
            .size > 1
    const { from, to } = filters
    const periodMs = from ? to.getTime() - from.getTime() : 0
    const previousFrom = from ? new Date(from.getTime() - periodMs) : null
    const previousTo = new Date((from?.getTime() ?? 0) - 1)

    const matchingRoutes = allRoutes.filter(
        (route) =>
            (filters.locations.length === 0 ||
                filters.locations.includes(route.location ?? '')) &&
            (filters.types.length === 0 ||
                filters.types.includes(route.type ?? '')),
    )
    const scopedRoutes = matchingRoutes.filter(
        (route) => filters.includeArchived || !route.archived,
    )
    const routeById = new Map(scopedRoutes.map((route) => [route.id, route]))
    const activeRoutes = scopedRoutes.filter((route) => !route.archived)

    const scopedRatings = allRatings.filter(
        (rating) => rating.route_id && routeById.has(rating.route_id),
    )
    const ratingsByRoute = new Map<string, AnalyticsRating[]>()
    for (const rating of scopedRatings) {
        const list = ratingsByRoute.get(rating.route_id!) ?? []
        list.push(rating)
        ratingsByRoute.set(rating.route_id!, list)
    }

    const routesSetIn = (start: Date | null, end: Date) =>
        scopedRoutes.filter((route) => inPeriod(routeDate(route), start, end))
    const ratingsIn = (start: Date | null, end: Date) =>
        scopedRatings.filter((rating) =>
            inPeriod(parseDate(rating.created), start, end),
        )
    const hasComment = (rating: AnalyticsRating) =>
        typeof rating.comment === 'string' && rating.comment.trim().length > 0
    const starValues = (ratings: AnalyticsRating[]) =>
        ratings
            .map((rating) => Number(rating.rating))
            .filter((value) => Number.isFinite(value) && value > 0)

    const routesSet = routesSetIn(from, to)
    const periodRatings = ratingsIn(from, to)
    const previousRoutesSet = previousFrom
        ? routesSetIn(previousFrom, previousTo)
        : null
    const previousRatings = previousFrom
        ? ratingsIn(previousFrom, previousTo)
        : null

    const trend = (
        current: number,
        previous: number | null | undefined,
    ): Trend => ({ value: current, previous: previous ?? null })

    const lifespans = matchingRoutes
        .filter((route) => route.archived && !route.permanent)
        .flatMap((route) => {
            const archivedAt = parseDate(route.archived_at)
            const setAt = routeDate(route)
            if (!archivedAt || !setAt || !inPeriod(archivedAt, from, to))
                return []
            const days = (archivedAt.getTime() - setAt.getTime()) / DAY_MS
            return days >= 0 ? [days] : []
        })

    const deviationOf = (route: AnalyticsRoute) => {
        const setScore = gradeScore(route)
        const votes = (ratingsByRoute.get(route.id) ?? [])
            .map(gradeScore)
            .filter((score): score is number => score !== null)
        if (setScore === null || votes.length < MIN_VOTES_FOR_FEEDBACK)
            return null
        const votedGrade = mean(votes)!
        return {
            votedGrade,
            deviation: votedGrade - setScore,
            votes: votes.length,
        }
    }

    const bucket: Bucket = !from
        ? 'month'
        : periodMs <= 62 * DAY_MS
          ? 'day'
          : periodMs <= 400 * DAY_MS
            ? 'week'
            : 'month'
    const routeTimeline = new Map<string, number>()
    for (const route of routesSet)
        increase(routeTimeline, bucketKey(routeDate(route)!, bucket))
    const ratingTimeline = new Map<string, number>()
    const commentTimeline = new Map<string, number>()
    const ratingDistribution = [0, 0, 0, 0, 0]
    for (const rating of periodRatings) {
        const key = bucketKey(parseDate(rating.created)!, bucket)
        increase(ratingTimeline, key)
        if (hasComment(rating)) increase(commentTimeline, key)
        const stars = Math.round(Number(rating.rating))
        if (stars >= 1 && stars <= 5) ratingDistribution[stars - 1]! += 1
    }
    const dailyRouteActivity = new Map<string, number>()
    for (const route of scopedRoutes) {
        const date = routeDate(route)
        if (date) increase(dailyRouteActivity, bucketKey(date, 'day'))
    }

    const routesSetIds = new Set(routesSet.map((route) => route.id))
    const setterRoutes = new Map<string, AnalyticsRoute[]>()
    for (const route of scopedRoutes) {
        for (const setter of normalizeCreators(route.creator)) {
            setterRoutes.set(setter, [
                ...(setterRoutes.get(setter) ?? []),
                route,
            ])
        }
    }
    const setters = [...setterRoutes.entries()]
        .map(([setter, routes]) => ({
            setter,
            routes: routes.length,
            routesInPeriod: routes.filter((route) => routesSetIds.has(route.id))
                .length,
            averageRating: round(
                mean(
                    routes.flatMap((route) =>
                        starValues(ratingsByRoute.get(route.id) ?? []),
                    ),
                ),
            ),
            averageDeviation: round(
                mean(
                    routes
                        .map((route) => deviationOf(route)?.deviation)
                        .filter(
                            (value): value is number => value !== undefined,
                        ),
                ),
            ),
        }))
        .sort((a, b) => b.routes - a.routes || a.setter.localeCompare(b.setter))

    const rated = scopedRoutes.flatMap((route) => {
        const stars = starValues(ratingsByRoute.get(route.id) ?? [])
        return stars.length >= MIN_VOTES_FOR_FEEDBACK
            ? [
                  {
                      ...summarize(route, withSystem),
                      averageRating: round(mean(stars))!,
                      ratings: stars.length,
                  },
              ]
            : []
    })
    const gradeAnalytics = (discipline: Discipline): GradeAnalytics => {
        const matching = matchingRoutes.filter(
            (route) => disciplineOf(route) === discipline,
        )
        const scoped = scopedRoutes.filter(
            (route) => disciplineOf(route) === discipline,
        )
        const disciplineWithSystem =
            new Set(matching.map((route) => route.grade_system).filter(Boolean))
                .size > 1
        const gradeRows = new Map<string, GradeDatum>()
        const historicShare = new Map<string, number>()
        for (const route of matching)
            increase(historicShare, gradeKey(route, disciplineWithSystem))
        for (const route of scoped) {
            const grade = gradeKey(route, disciplineWithSystem)
            const row = gradeRows.get(grade) ?? { grade, total: 0, expected: 0 }
            row.total += 1
            gradeRows.set(grade, row)
        }
        for (const [grade, count] of historicShare) {
            if (!gradeRows.has(grade))
                gradeRows.set(grade, { grade, total: 0, expected: 0 })
            gradeRows.get(grade)!.expected = round(
                (count / matching.length) * scoped.length,
                1,
            )!
        }
        const gradeDistribution = [...gradeRows.values()].sort((a, b) =>
            compareGrades(a.grade, b.grade),
        )
        const locationGradeCounts = new Map<string, LocationGradeDatum>()
        for (const route of scoped) {
            const location = route.locationName || '?'
            const grade = gradeKey(route, disciplineWithSystem)
            const key = `${location}\u0000${grade}`
            const cell = locationGradeCounts.get(key) ?? {
                location,
                grade,
                count: 0,
            }
            cell.count += 1
            locationGradeCounts.set(key, cell)
        }

        const feedback = scoped.flatMap((route) => {
            const result = deviationOf(route)
            return result
                ? [
                      {
                          ...summarize(route, disciplineWithSystem),
                          setGrade: round(gradeScore(route))!,
                          votedGrade: round(result.votedGrade)!,
                          votedGradeLabel: isGradeSystem(route.grade_system)
                              ? nearestGrade(
                                    route.grade_system,
                                    result.votedGrade,
                                )
                              : '',
                          deviation: round(result.deviation)!,
                          votes: result.votes,
                      },
                  ]
                : []
        })
        return {
            gradeDistribution,
            locationGrades: [...locationGradeCounts.values()],
            gradeFeedback: feedback
                .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
                .slice(0, FEEDBACK_LIMIT),
        }
    }

    const topRated = [...rated]
        .sort(
            (a, b) =>
                b.averageRating - a.averageRating || b.ratings - a.ratings,
        )
        .slice(0, LIST_LIMIT)
    const topRatedIds = new Set(topRated.map((route) => route.id))
    const byRouteDate = (a: AnalyticsRoute, b: AnalyticsRoute) =>
        (routeDate(a)?.getTime() ?? 0) - (routeDate(b)?.getTime() ?? 0)

    return {
        generatedAt: now.toISOString(),
        period: { from: from?.toISOString() ?? null, to: to.toISOString() },
        bucket,
        summary: {
            activeRoutes: activeRoutes.length,
            routesSet: trend(routesSet.length, previousRoutesSet?.length),
            ratings: trend(periodRatings.length, previousRatings?.length),
            averageRating: trend(
                round(mean(starValues(periodRatings))) ?? 0,
                previousRatings
                    ? round(mean(starValues(previousRatings)))
                    : null,
            ),
            comments: trend(
                periodRatings.filter(hasComment).length,
                previousRatings?.filter(hasComment).length,
            ),
            averageLifespanDays:
                lifespans.length > 0 ? Math.round(mean(lifespans)!) : null,
            unratedRoutes: activeRoutes.filter(
                (route) => !ratingsByRoute.has(route.id),
            ).length,
        },
        grades: {
            Boulder: gradeAnalytics('Boulder'),
            Route: gradeAnalytics('Route'),
        },
        routeTimeline: fillBuckets(routeTimeline, from, to, bucket),
        ratingTimeline: fillBuckets(ratingTimeline, from, to, bucket),
        commentTimeline: fillBuckets(commentTimeline, from, to, bucket),
        dailyRouteActivity: toTimeline(dailyRouteActivity),
        ratingDistribution,
        setters,
        ratingBaseline: round(mean(rated.map((route) => route.averageRating))),
        topRated,
        lowestRated: rated
            .filter((route) => !topRatedIds.has(route.id))
            .sort(
                (a, b) =>
                    a.averageRating - b.averageRating || b.ratings - a.ratings,
            )
            .slice(0, LIST_LIMIT),
        oldestActive: activeRoutes
            .filter((route) => !route.permanent)
            .sort(byRouteDate)
            .slice(0, OLDEST_LIMIT)
            .map((route) => ({
                ...summarize(route, withSystem),
                ageDays: Math.floor(
                    (now.getTime() -
                        (routeDate(route)?.getTime() ?? now.getTime())) /
                        DAY_MS,
                ),
            })),
        latestComments: periodRatings
            .filter(hasComment)
            .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
            .slice(0, LIST_LIMIT)
            .map((rating) => ({
                id: rating.id,
                routeId: rating.route_id ?? null,
                routeName: String(routeById.get(rating.route_id!)?.name ?? ''),
                rating: Number.isFinite(Number(rating.rating))
                    ? Number(rating.rating)
                    : null,
                comment: rating.comment!.trim(),
                created: rating.created ?? null,
            })),
    }
}
