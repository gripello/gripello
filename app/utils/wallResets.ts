import type { WallRecord } from '~/types/models'
import { localDateYYYYMMDD } from '#shared/utils/formatting'

const DAY_MS = 86_400_000

export interface PlannableRoute {
    id: string
    type?: string | null
    wall?: string | null
    archived?: boolean
    permanent?: boolean
    screw_date?: string | null
    created?: string
    removal_planned_for?: string | null
}

export interface RouteStats {
    recent_ticks: number
    ticks: number
    average_rating: number | null
    ratings: number
    grade_deviation: number | null
    open_defects: number
}

export const RESET_FLAGS = [
    'defect',
    'old',
    'stale',
    'disliked',
    'quiet',
    'gradeOff',
] as const
export type ResetFlag = (typeof RESET_FLAGS)[number]

export const RESET_FLAG_STYLE: Record<
    ResetFlag,
    {
        icon: string
        color: 'error' | 'warning' | 'info' | 'neutral'
        weight: number
        textClass: string
    }
> = {
    defect: {
        icon: 'i-lucide-wrench',
        color: 'error',
        weight: 3,
        textClass: 'text-error',
    },
    old: {
        icon: 'i-lucide-hourglass',
        color: 'error',
        weight: 3,
        textClass: 'text-error',
    },
    stale: {
        icon: 'i-lucide-moon',
        color: 'warning',
        weight: 2,
        textClass: 'text-warning',
    },
    disliked: {
        icon: 'i-lucide-thumbs-down',
        color: 'warning',
        weight: 2,
        textClass: 'text-warning',
    },
    quiet: {
        icon: 'i-lucide-trending-down',
        color: 'info',
        weight: 1,
        textClass: 'text-info',
    },
    gradeOff: {
        icon: 'i-lucide-arrow-up-down',
        color: 'neutral',
        weight: 1,
        textClass: 'text-muted',
    },
}

// Boulders turn over in weeks, rope routes in months: below these ages nothing counts as old.
const MIN_OLD_DAYS = { Boulder: 42, Route: 90 }
const OLD_QUANTILE = 0.75
const SETTLE_DAYS = 14
const STALE_DAYS = 21
const MIN_RATINGS = 3
const DISLIKED_STARS = 2.5
const GRADE_OFF = 1
const QUIET_SHARE = 0.25
const MIN_TYPICAL_TICKS = 4
const MIN_TYPICAL_STALE = 1

type Discipline = keyof typeof MIN_OLD_DAYS
const disciplineOf = (route: PlannableRoute): Discipline =>
    route.type === 'Route' ? 'Route' : 'Boulder'

export function routeAgeDays(route: PlannableRoute, now = new Date()) {
    const set = Date.parse(route.screw_date || route.created || '')
    return Number.isNaN(set)
        ? null
        : Math.max(0, Math.floor((now.getTime() - set) / DAY_MS))
}

function quantile(values: number[], q: number) {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const position = (sorted.length - 1) * q
    const low = Math.floor(position)
    const high = Math.ceil(position)
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low)
}

export interface ResetContext {
    oldAfterDays: ReadonlyMap<Discipline, number>
    typicalRecentTicks: ReadonlyMap<Discipline, number>
}

// What counts as old or quiet is relative to the location: its oldest quarter and its usual traffic.
export function resetContext(
    routes: PlannableRoute[],
    stats: ReadonlyMap<string, RouteStats>,
    now = new Date(),
): ResetContext {
    const ages = new Map<Discipline, number[]>()
    const recent = new Map<Discipline, number[]>()
    for (const route of routes) {
        const age = routeAgeDays(route, now)
        if (route.permanent || route.archived || age === null) continue
        const discipline = disciplineOf(route)
        ages.set(discipline, [...(ages.get(discipline) ?? []), age])
        const stat = stats.get(route.id)
        if (stat && age >= SETTLE_DAYS)
            recent.set(discipline, [
                ...(recent.get(discipline) ?? []),
                stat.recent_ticks,
            ])
    }
    return {
        oldAfterDays: new Map(
            [...ages].map(([discipline, list]) => [
                discipline,
                Math.max(
                    MIN_OLD_DAYS[discipline],
                    quantile(list, OLD_QUANTILE),
                ),
            ]),
        ),
        typicalRecentTicks: new Map(
            [...recent].map(([discipline, list]) => [
                discipline,
                quantile(list, 0.5),
            ]),
        ),
    }
}

export function resetFlags(
    route: PlannableRoute,
    stat: RouteStats | undefined,
    context: ResetContext,
    now = new Date(),
): ResetFlag[] {
    if (route.permanent) return []
    const age = routeAgeDays(route, now)
    const discipline = disciplineOf(route)
    const flags: ResetFlag[] = []
    if (stat?.open_defects) flags.push('defect')
    const oldAfter =
        context.oldAfterDays.get(discipline) ?? MIN_OLD_DAYS[discipline]
    if (age !== null && age >= oldAfter) flags.push('old')
    if (!stat) return flags
    const usual = context.typicalRecentTicks.get(discipline) ?? 0
    // Where climbers rarely log, an empty month says nothing about the route.
    const stale =
        usual >= MIN_TYPICAL_STALE &&
        age !== null &&
        age >= STALE_DAYS &&
        stat.recent_ticks === 0
    if (stale) flags.push('stale')
    if (
        stat.ratings >= MIN_RATINGS &&
        (stat.average_rating ?? 5) <= DISLIKED_STARS
    )
        flags.push('disliked')
    if (
        age !== null &&
        age >= SETTLE_DAYS &&
        !stale &&
        usual >= MIN_TYPICAL_TICKS &&
        stat.recent_ticks < usual * QUIET_SHARE
    )
        flags.push('quiet')
    if (Math.abs(stat.grade_deviation ?? 0) >= GRADE_OFF) flags.push('gradeOff')
    return flags
}

export const resetScore = (flags: ResetFlag[]) =>
    flags.reduce((sum, flag) => sum + RESET_FLAG_STYLE[flag].weight, 0)

// Rank of each value among all values, 0 (lowest) to 1 (highest); ties share the middle of their ranks.
export function percentileRanks(values: ReadonlyMap<string, number>) {
    const sorted = [...values.values()].sort((a, b) => a - b)
    const last = Math.max(1, sorted.length - 1)
    return new Map(
        [...values].map(([key, value]) => [
            key,
            sorted.length > 1
                ? (sorted.indexOf(value) + sorted.lastIndexOf(value)) / 2 / last
                : 0.5,
        ]),
    )
}

// 0 = least urgent in the location, 1 = most urgent: age rank plus flag weight.
export function routeUrgency(
    routes: PlannableRoute[],
    flagsOf: (route: PlannableRoute) => ResetFlag[],
    now = new Date(),
) {
    const candidates = routes.filter(
        (route) => !route.permanent && !route.archived,
    )
    const ageRanks = percentileRanks(
        new Map(
            candidates.map((route) => [
                route.id,
                routeAgeDays(route, now) ?? 0,
            ]),
        ),
    )
    return percentileRanks(
        new Map(
            candidates.map((route) => [
                route.id,
                ageRanks.get(route.id)! + resetScore(flagsOf(route)) / 6,
            ]),
        ),
    )
}

// Green → amber → red through the theme tokens.
export function heatColor(heat: number) {
    const t = Math.min(1, Math.max(0, heat))
    return t < 0.5
        ? `color-mix(in oklab, var(--ui-warning) ${Math.round(t * 200)}%, var(--ui-success))`
        : `color-mix(in oklab, var(--ui-error) ${Math.round((t - 0.5) * 200)}%, var(--ui-warning))`
}

export const heatLevel = (heat: number) =>
    heat >= 2 / 3 ? 'high' : heat >= 1 / 3 ? 'medium' : 'low'

export interface WallResetRow<
    W extends WallRecord = WallRecord,
    R extends PlannableRoute = PlannableRoute,
> {
    wall: W
    routes: R[]
    planned: R[]
    flagged: R[]
    flags: ReadonlyMap<string, ResetFlag[]>
    plannedFor: string | null
    averageAgeDays: number | null
    heat: number
}

interface RowOptions<R> {
    now?: Date
    flagsOf?: (route: R) => ResetFlag[]
    urgency?: ReadonlyMap<string, number>
}

export function wallResetRows<W extends WallRecord, R extends PlannableRoute>(
    walls: W[],
    routes: R[],
    { now = new Date(), flagsOf = () => [], urgency }: RowOptions<R> = {},
): WallResetRow<W, R>[] {
    const byWall = new Map<string, R[]>()
    for (const route of routes) {
        if (!route.wall || route.archived) continue
        byWall.set(route.wall, [...(byWall.get(route.wall) ?? []), route])
    }
    const urgencyOf = (route: R) => urgency?.get(route.id) ?? 0
    const rows = walls.map((wall) => {
        const wallRoutes = byWall.get(wall.id) ?? []
        const flags = new Map(
            wallRoutes.map((route) => [route.id, flagsOf(route)]),
        )
        const candidates = wallRoutes.filter((route) => !route.permanent)
        const ages = candidates
            .map((route) => routeAgeDays(route, now))
            .filter((days): days is number => days !== null)
        const planned = wallRoutes.filter((route) => route.removal_planned_for)
        const sorted = [...wallRoutes].sort(
            (a, b) =>
                urgencyOf(b) - urgencyOf(a) ||
                (routeAgeDays(b, now) ?? -1) - (routeAgeDays(a, now) ?? -1),
        )
        return {
            wall,
            routes: sorted,
            planned,
            flagged: sorted.filter(
                (route) => (flags.get(route.id) ?? []).length > 0,
            ),
            flags,
            plannedFor:
                planned.map((route) => route.removal_planned_for!).sort()[0] ??
                null,
            averageAgeDays: ages.length
                ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length)
                : null,
            heat: candidates.length
                ? candidates.reduce((sum, route) => sum + urgencyOf(route), 0) /
                  candidates.length
                : -1,
        }
    })
    const heats = rows.map((row) => row.heat).filter((heat) => heat >= 0)
    const low = Math.min(...heats)
    const high = Math.max(...heats)
    for (const row of rows)
        row.heat =
            row.heat < 0
                ? 0
                : high > low
                  ? (row.heat - low) / (high - low)
                  : 0.5
    return rows.sort(
        (a, b) =>
            (a.plannedFor ?? '￿').localeCompare(b.plannedFor ?? '￿') ||
            b.heat - a.heat,
    )
}

const idSet = (routes: PlannableRoute[]) =>
    new Set(routes.map((route) => route.id))

export const plannableRoutes = <R extends PlannableRoute>(
    row: WallResetRow<WallRecord, R>,
) => row.routes.filter((route) => !route.permanent)

export function defaultRemovalSelection(row: WallResetRow) {
    if (row.planned.length) return idSet(row.planned)
    return idSet(row.flagged.length ? row.flagged : plannableRoutes(row))
}

export function oldestHalf(row: WallResetRow, now = new Date()) {
    const byAge = [...plannableRoutes(row)].sort(
        (a, b) => (routeAgeDays(b, now) ?? -1) - (routeAgeDays(a, now) ?? -1),
    )
    return idSet(byAge.slice(0, Math.ceil(byAge.length / 2)))
}

export function weeksFromToday(weeks: number, today = new Date()) {
    const date = new Date(today)
    date.setDate(date.getDate() + weeks * 7)
    return localDateYYYYMMDD(date)
}

// Ages read best in the largest whole unit: 45 days, 7 months, 20 years.
export function ageUnit(days: number): {
    key: 'days' | 'months' | 'years'
    n: number
} {
    if (days < 60) return { key: 'days', n: days }
    if (days < 730) return { key: 'months', n: Math.round(days / 30.44) }
    return { key: 'years', n: Math.round(days / 365.25) }
}
