import { GRADE_TABLES, type GradeSystem } from '#shared/utils/grades'
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

export interface WallSummary<Route extends OverviewRoute = OverviewRoute> {
    id: string
    name: string
    location: string
    routes: Route[]
    fresh: number
}

export interface GradeAxis {
    min: number
    max: number
    ticks: { label: string; at: number }[]
}

export interface RailDot {
    id: string
    at: number
    level: number
    fresh: boolean
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

export function wallSummaries<Route extends OverviewRoute>(
    walls: {
        id: string
        name: string
        location: string
        sort?: number | null
    }[],
    routes: Route[],
    now: Date,
): WallSummary<Route>[] {
    return [...walls]
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((wall) => {
            const onWall = routes.filter((route) => route.wall === wall.id)
            return {
                id: wall.id,
                name: wall.name,
                location: wall.location,
                routes: onWall,
                fresh: onWall.filter((route) => isNewRoute(route, now)).length,
            }
        })
}

const AXIS_PADDING = 0.6
const MAX_TICKS = 6

export function gradeAxis(
    indexes: number[],
    system: GradeSystem,
): GradeAxis | null {
    if (!indexes.length) return null
    const min = Math.min(...indexes) - AXIS_PADDING
    const max = Math.max(...indexes) + AXIS_PADDING
    const plain = GRADE_TABLES[system].filter(
        ([label, index]) =>
            index >= min && index <= max && !/[+-]$/.test(label),
    )
    const every = Math.ceil(plain.length / MAX_TICKS)
    return {
        min,
        max,
        ticks: plain
            .filter((_, position) => position % every === 0)
            .map(([label, index]) => ({
                label,
                at: (index - min) / (max - min),
            })),
    }
}

export function railDots(
    routes: OverviewRoute[],
    axis: GradeAxis,
    now: Date,
): RailDot[] {
    const levels = new Map<number, number>()
    return routes
        .filter((route) => typeof route.grade_index === 'number')
        .sort((a, b) => a.grade_index! - b.grade_index!)
        .map((route) => {
            const level = levels.get(route.grade_index!) ?? 0
            levels.set(route.grade_index!, level + 1)
            return {
                id: route.id,
                at: (route.grade_index! - axis.min) / (axis.max - axis.min),
                level,
                fresh: isNewRoute(route, now),
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
