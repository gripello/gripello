import { parseDate } from '#shared/utils/formatting'
export const NEW_ROUTE_WINDOW_DAYS = 14
export const POPULAR_MIN_RATINGS = 2

export interface OverviewRoute {
    id: string
    name: string
    type?: string | null
    grade?: string | null
    grade_system?: string | null
    grade_index?: number | null
    screw_date?: string | null
    wall?: string | null
    location?: string | null
    average_rating?: number | null
    ratings_count?: number | null
}

export interface WallSummary {
    id: string
    name: string
    location: string
    count: number
    ranges: GradeRange[]
    newest: string | null
}

export interface GradeRange {
    type: 'Boulder' | 'Route'
    easiest: string
    hardest: string
}

const DAY_MS = 86_400_000

function setTime(route: Pick<OverviewRoute, 'screw_date'>): number {
    return parseDate(route.screw_date)?.getTime() ?? 0
}

export function isNewRoute(
    route: Pick<OverviewRoute, 'screw_date'>,
    now: Date,
) {
    const time = setTime(route)
    return (
        time > now.getTime() - NEW_ROUTE_WINDOW_DAYS * DAY_MS &&
        time <= now.getTime() + DAY_MS
    )
}

export function newRoutes<Route extends OverviewRoute>(
    routes: Route[],
    now: Date,
): Route[] {
    return routes
        .filter((route) => isNewRoute(route, now))
        .sort((a, b) => setTime(b) - setTime(a))
}

export function popularRoutes<Route extends OverviewRoute>(
    routes: Route[],
    limit: number,
): Route[] {
    return routes
        .filter(
            (route) =>
                (route.ratings_count ?? 0) >= POPULAR_MIN_RATINGS &&
                typeof route.average_rating === 'number',
        )
        .sort(
            (a, b) =>
                b.average_rating! - a.average_rating! ||
                (b.ratings_count ?? 0) - (a.ratings_count ?? 0),
        )
        .slice(0, limit)
}

export function gradeSpread(
    routes: OverviewRoute[],
    grades: string[],
): { grade: string; count: number }[] {
    const counts = new Map(grades.map((grade) => [grade, 0]))
    for (const route of routes) {
        if (route.grade && counts.has(route.grade))
            counts.set(route.grade, counts.get(route.grade)! + 1)
    }
    const used = grades.filter((grade) => counts.get(grade)! > 0)
    if (!used.length) return []
    const first = grades.indexOf(used[0]!)
    const last = grades.indexOf(used[used.length - 1]!)
    return grades
        .slice(first, last + 1)
        .map((grade) => ({ grade, count: counts.get(grade)! }))
}

export function wallSummaries(
    walls: {
        id: string
        name: string
        location: string
        sort?: number | null
    }[],
    routes: OverviewRoute[],
): WallSummary[] {
    return [...walls]
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((wall) => {
            const onWall = routes
                .filter((route) => route.wall === wall.id)
                .sort((a, b) => (a.grade_index ?? 0) - (b.grade_index ?? 0))
            const newest = onWall.reduce<OverviewRoute | null>(
                (best, route) =>
                    !best || setTime(route) > setTime(best) ? route : best,
                null,
            )
            return {
                id: wall.id,
                name: wall.name,
                location: wall.location,
                count: onWall.length,
                ranges: (['Boulder', 'Route'] as const).flatMap((type) => {
                    const graded = onWall.filter(
                        (route) =>
                            (route.type === 'Boulder') ===
                                (type === 'Boulder') && route.grade,
                    )
                    return graded.length
                        ? [
                              {
                                  type,
                                  easiest: graded[0]!.grade!,
                                  hardest: graded.at(-1)!.grade!,
                              },
                          ]
                        : []
                }),
                newest: newest?.screw_date ?? null,
            }
        })
}

export function sentShare(
    routes: OverviewRoute[],
    sentIds: ReadonlySet<string>,
): { sent: number; total: number } {
    return {
        sent: routes.filter((route) => sentIds.has(route.id)).length,
        total: routes.length,
    }
}
