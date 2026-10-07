import { BOULDER_GRADE_SYSTEMS, gradeKey, type GradeSystem } from './grades'
import { compareGrades, gradeScore } from './analytics'
import { localDay, tickDay, type TickType } from './ticks'

export type LogbookKind = 'boulder' | 'route'
export type LogbookRange = '30d' | '12m' | 'all'

export interface LogbookTick {
    route?: string | null
    type: TickType
    attempts: number
    date: string
    grade?: string | null
    grade_system?: string | null
    grade_index?: number | null
    routeArchived?: boolean
}

export interface HardestSend {
    grade: string
    grade_system: string | null
    grade_index: number
}

export interface LogbookStats {
    sends: number
    flashes: number
    flashRate: number | null
    sessions: number
    hardest: HardestSend | null
}

const DAY_MS = 86_400_000
const RANGE_DAYS: Record<LogbookRange, number | null> = {
    '30d': 30,
    '12m': 365,
    all: null,
}

export function tickKind(tick: Pick<LogbookTick, 'grade_system'>): LogbookKind {
    return BOULDER_GRADE_SYSTEMS.includes(tick.grade_system as GradeSystem)
        ? 'boulder'
        : 'route'
}

export function isSend(tick: Pick<LogbookTick, 'type'>): boolean {
    return tick.type !== 'attempt'
}

export function preferredKind(ticks: LogbookTick[]): LogbookKind {
    const boulders = ticks.filter(
        (tick) => isSend(tick) && tickKind(tick) === 'boulder',
    ).length
    const routes = ticks.filter(
        (tick) => isSend(tick) && tickKind(tick) === 'route',
    ).length
    return routes > boulders ? 'route' : 'boulder'
}

function tickTime(tick: LogbookTick): number {
    return new Date(`${tickDay(tick.date)}T12:00:00Z`).getTime()
}

function inWindow(tick: LogbookTick, start: number | null, end: number) {
    const time = tickTime(tick)
    return (start === null || time > start) && time <= end
}

function windowEnd(now: Date): number {
    return new Date(`${localDay(now)}T12:00:00Z`).getTime()
}

function windowStart(range: LogbookRange, now: Date, periodsBack = 0) {
    const days = RANGE_DAYS[range]
    if (days === null) return null
    return now.getTime() - days * DAY_MS * (periodsBack + 1)
}

function hardestOf(ticks: LogbookTick[]): HardestSend | null {
    let best: HardestSend | null = null
    for (const tick of ticks) {
        const score = isSend(tick) ? gradeScore(tick) : null
        if (score !== null && (!best || score > best.grade_index)) {
            best = {
                grade: tick.grade ?? '',
                grade_system: tick.grade_system ?? null,
                grade_index: score,
            }
        }
    }
    return best
}

function statsOf(ticks: LogbookTick[]): LogbookStats {
    const sends = ticks.filter(isSend)
    const flashes = sends.filter((tick) => tick.type === 'flash').length
    return {
        sends: sends.length,
        flashes,
        flashRate: sends.length ? flashes / sends.length : null,
        sessions: new Set(ticks.map((tick) => tickDay(tick.date))).size,
        hardest: hardestOf(ticks),
    }
}

export function logbookStats(
    ticks: LogbookTick[],
    kind: LogbookKind,
    range: LogbookRange,
    now = new Date(),
): { current: LogbookStats; previous: LogbookStats | null } {
    const ofKind = ticks.filter((tick) => tickKind(tick) === kind)
    const end = windowEnd(now)
    const start = windowStart(range, now)
    const current = statsOf(ofKind.filter((tick) => inWindow(tick, start, end)))
    if (start === null) return { current, previous: null }
    const previousStart = windowStart(range, now, 1)
    return {
        current,
        previous: statsOf(
            ofKind.filter((tick) => inWindow(tick, previousStart, start)),
        ),
    }
}

export interface PyramidRow {
    grade: string
    flash: number
    top: number
}

export function gradePyramid(
    ticks: LogbookTick[],
    kind: LogbookKind,
    range: LogbookRange,
    now = new Date(),
): PyramidRow[] {
    const start = windowStart(range, now)
    const sends = ticks.filter(
        (tick) =>
            isSend(tick) &&
            tick.grade &&
            tickKind(tick) === kind &&
            inWindow(tick, start, windowEnd(now)),
    )
    const withSystem =
        new Set(sends.map((tick) => tick.grade_system).filter(Boolean)).size > 1
    const rows = new Map<string, PyramidRow>()
    for (const tick of sends) {
        const grade = gradeKey(tick, withSystem)
        const row = rows.get(grade) ?? { grade, flash: 0, top: 0 }
        row[tick.type === 'flash' ? 'flash' : 'top'] += 1
        rows.set(grade, row)
    }
    return [...rows.values()].sort((a, b) => compareGrades(b.grade, a.grade))
}

export interface ProgressionPoint {
    period: string
    sends: number
    maxIndex: number | null
}

export function progression(
    ticks: LogbookTick[],
    kind: LogbookKind,
    now = new Date(),
    months = 12,
): ProgressionPoint[] {
    const points = new Map<string, ProgressionPoint>()
    for (let back = months - 1; back >= 0; back--) {
        const period = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1),
        )
            .toISOString()
            .slice(0, 7)
        points.set(period, { period, sends: 0, maxIndex: null })
    }
    for (const tick of ticks) {
        if (!isSend(tick) || tickKind(tick) !== kind) continue
        const point = points.get(tickDay(tick.date).slice(0, 7))
        if (!point) continue
        point.sends += 1
        const score = gradeScore(tick)
        if (
            score !== null &&
            (point.maxIndex === null || score > point.maxIndex)
        ) {
            point.maxIndex = score
        }
    }
    return [...points.values()]
}

export interface SessionSummary {
    climbs: number
    sends: number
    flashes: number
    hardest: (HardestSend & { kind: LogbookKind })[]
}

export function sessionSummary(dayTicks: LogbookTick[]): SessionSummary {
    const sends = dayTicks.filter(isSend)
    return {
        climbs: dayTicks.length,
        sends: sends.length,
        flashes: sends.filter((tick) => tick.type === 'flash').length,
        hardest: (['boulder', 'route'] as const).flatMap((kind) => {
            const best = hardestOf(
                dayTicks.filter((tick) => tickKind(tick) === kind),
            )
            return best ? [{ ...best, kind }] : []
        }),
    }
}

export interface OpenProject {
    route: string
    attempts: number
    lastTried: string
}

export function openProjects(ticks: LogbookTick[]): OpenProject[] {
    const sent = new Set(ticks.filter(isSend).map((tick) => tick.route ?? ''))
    const projects = new Map<string, OpenProject>()
    for (const tick of ticks) {
        if (!tick.route || sent.has(tick.route) || tick.routeArchived) continue
        const project = projects.get(tick.route) ?? {
            route: tick.route,
            attempts: 0,
            lastTried: tickDay(tick.date),
        }
        project.attempts += tick.attempts
        if (tickDay(tick.date) > project.lastTried) {
            project.lastTried = tickDay(tick.date)
        }
        projects.set(tick.route, project)
    }
    return [...projects.values()].sort((a, b) =>
        b.lastTried.localeCompare(a.lastTried),
    )
}

export function medianSendIndex(
    ticks: LogbookTick[],
    kind: LogbookKind,
): number | null {
    const values = ticks
        .filter((tick) => isSend(tick) && tickKind(tick) === kind)
        .map(gradeScore)
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b)
    return values.length ? values[Math.floor(values.length / 2)]! : null
}

export interface LogbookComparison {
    mine: LogbookStats
    theirs: LogbookStats
    both: string[]
    onlyTheirs: string[]
}

function sentRoutes(ticks: LogbookTick[]): Set<string> {
    return new Set(
        ticks
            .filter((tick) => isSend(tick) && tick.route)
            .map((tick) => tick.route!),
    )
}

export function compareLogbooks(
    mine: LogbookTick[],
    theirs: LogbookTick[],
    kind: LogbookKind,
    range: LogbookRange,
    now = new Date(),
): LogbookComparison {
    const scoped = (ticks: LogbookTick[]) =>
        ticks.filter(
            (tick) =>
                tickKind(tick) === kind &&
                inWindow(tick, windowStart(range, now), windowEnd(now)),
        )
    const mineScoped = scoped(mine)
    const theirsScoped = scoped(theirs)
    const mySends = sentRoutes(mine.filter((tick) => tickKind(tick) === kind))
    const theirSends = [...sentRoutes(theirsScoped)]
    return {
        mine: statsOf(mineScoped),
        theirs: statsOf(theirsScoped),
        both: theirSends.filter((route) => mySends.has(route)),
        onlyTheirs: theirSends.filter((route) => !mySends.has(route)),
    }
}
