import { describe, expect, it } from 'vitest'
import { gradeIndex } from '#shared/utils/grades'
import {
    compareLogbooks,
    gradePyramid,
    logbookStats,
    medianSendIndex,
    openProjects,
    preferredKind,
    progression,
    sessionSummary,
    tickKind,
    type LogbookTick,
} from '#shared/utils/logbook'
import { localDay, type TickType } from '#shared/utils/ticks'

const NOW = new Date('2026-09-26T18:00:00Z')

function daysAgo(days: number) {
    const date = new Date(NOW.getTime() - days * 86_400_000)
    return `${date.toISOString().slice(0, 10)} 12:00:00.000Z`
}

function tick(
    type: TickType,
    grade: string,
    overrides: Partial<LogbookTick> = {},
): LogbookTick {
    const system = overrides.grade_system ?? 'font'
    return {
        route: `route-${grade}`,
        type,
        attempts: type === 'flash' ? 1 : 2,
        date: daysAgo(1),
        grade,
        grade_system: system,
        grade_index: gradeIndex(system as 'font', grade),
        ...overrides,
    }
}

describe('tickKind', () => {
    it('classifies ticks by the scale they were logged in', () => {
        expect(tickKind({ grade_system: 'font' })).toBe('boulder')
        expect(tickKind({ grade_system: 'v' })).toBe('boulder')
        expect(tickKind({ grade_system: 'uiaa' })).toBe('route')
        expect(tickKind({ grade_system: null })).toBe('route')
    })

    it('prefers the kind with more sends', () => {
        const route = { grade_system: 'uiaa' as const }
        expect(
            preferredKind([
                tick('top', '6+', { ...route, grade_index: 14 }),
                tick('top', '7-', { ...route, grade_index: 15 }),
                tick('flash', '6A'),
            ]),
        ).toBe('route')
        expect(preferredKind([])).toBe('boulder')
    })
})

describe('logbookStats', () => {
    it('counts sends, flashes, sessions and the hardest send in range', () => {
        const ticks = [
            tick('flash', '6A', { date: daysAgo(1) }),
            tick('top', '6C', { date: daysAgo(1) }),
            tick('attempt', '7A', { date: daysAgo(3) }),
            tick('top', '7A', { date: daysAgo(40) }),
        ]
        const { current, previous } = logbookStats(ticks, 'boulder', '30d', NOW)
        expect(current).toMatchObject({
            sends: 2,
            flashes: 1,
            flashRate: 0.5,
            sessions: 2,
        })
        expect(current.hardest?.grade).toBe('6C')
        expect(previous).toMatchObject({ sends: 1, sessions: 1 })
        expect(previous?.hardest?.grade).toBe('7A')
    })

    it('has no previous period for all time and ignores other kinds', () => {
        const ticks = [
            tick('top', '6A'),
            tick('top', '7', { grade_system: 'uiaa', grade_index: 16 }),
        ]
        const { current, previous } = logbookStats(ticks, 'boulder', 'all', NOW)
        expect(current.sends).toBe(1)
        expect(previous).toBeNull()
        expect(
            logbookStats([tick('attempt', '6A')], 'boulder', 'all', NOW).current
                .flashRate,
        ).toBeNull()
    })
})

describe('ticks logged for today', () => {
    it('count before noon UTC', () => {
        const morning = new Date(2026, 8, 27, 6, 0)
        const today = `${localDay(morning)} 12:00:00.000Z`
        const ticks = [tick('flash', '6A', { date: today })]
        expect(
            logbookStats(ticks, 'boulder', '30d', morning).current.sends,
        ).toBe(1)
        expect(gradePyramid(ticks, 'boulder', '30d', morning)).toHaveLength(1)
    })

    it('still leave out ascents dated tomorrow', () => {
        const now = new Date(2026, 8, 27, 20, 0)
        const tomorrow = new Date(2026, 8, 28, 12, 0)
        const ticks = [
            tick('top', '6A', { date: `${localDay(tomorrow)} 12:00:00.000Z` }),
        ]
        expect(logbookStats(ticks, 'boulder', '30d', now).current.sends).toBe(0)
    })
})

describe('gradePyramid', () => {
    it('splits sends into flash and top, hardest grade first', () => {
        const rows = gradePyramid(
            [
                tick('flash', '6A'),
                tick('top', '6A'),
                tick('top', '6B'),
                tick('attempt', '7A'),
            ],
            'boulder',
            'all',
            NOW,
        )
        expect(rows).toEqual([
            { grade: '6B', flash: 0, top: 1 },
            { grade: '6A', flash: 1, top: 1 },
        ])
    })

    it('orders Font grades by the Font scale', () => {
        const rows = gradePyramid(
            [tick('top', '3'), tick('top', '<2'), tick('top', '6A')],
            'boulder',
            'all',
            NOW,
        )
        expect(rows.map((row) => row.grade)).toEqual(['6A', '3', '<2'])
    })

    it('keeps scales apart when several are mixed', () => {
        const rows = gradePyramid(
            [
                tick('top', '6A'),
                tick('top', 'V3', { grade_system: 'v', grade_index: 13 }),
            ],
            'boulder',
            'all',
            NOW,
        )
        expect(rows.map((row) => row.grade).sort()).toEqual([
            '6A · Font',
            'V3 · Hueco',
        ])
    })
})

describe('progression', () => {
    it('fills twelve months and tracks the hardest send per month', () => {
        const points = progression(
            [
                tick('top', '6A', { date: '2026-09-02 12:00:00.000Z' }),
                tick('flash', '6C', { date: '2026-09-20 12:00:00.000Z' }),
                tick('attempt', '7C', { date: '2026-09-21 12:00:00.000Z' }),
                tick('top', '6B', { date: '2026-01-10 12:00:00.000Z' }),
            ],
            'boulder',
            NOW,
        )
        expect(points).toHaveLength(12)
        expect(points[0]!.period).toBe('2025-10')
        expect(points.at(-1)).toEqual({
            period: '2026-09',
            sends: 2,
            maxIndex: gradeIndex('font', '6C'),
        })
        expect(points.find((point) => point.period === '2026-03')).toEqual({
            period: '2026-03',
            sends: 0,
            maxIndex: null,
        })
    })
})

describe('sessionSummary', () => {
    it('summarises one day', () => {
        expect(
            sessionSummary([
                tick('flash', '6A'),
                tick('top', '6C'),
                tick('attempt', '7A'),
            ]),
        ).toMatchObject({ climbs: 3, sends: 2, flashes: 1 })
    })

    it('keeps the hardest boulder and route apart', () => {
        expect(
            sessionSummary([
                tick('top', '6B'),
                tick('top', '8', { grade_system: 'uiaa' }),
            ]).hardest.map(({ kind, grade }) => [kind, grade]),
        ).toEqual([
            ['boulder', '6B'],
            ['route', '8'],
        ])
    })
})

describe('openProjects', () => {
    it('lists attempted routes that are neither sent nor archived', () => {
        const projects = openProjects([
            tick('attempt', '7A', {
                route: 'a',
                date: daysAgo(5),
                attempts: 3,
            }),
            tick('attempt', '7A', {
                route: 'a',
                date: daysAgo(2),
                attempts: 2,
            }),
            tick('attempt', '6C', { route: 'b', date: daysAgo(4) }),
            tick('top', '6C', { route: 'b', date: daysAgo(1) }),
            tick('attempt', '7B', { route: 'c', routeArchived: true }),
            tick('attempt', '7B', { route: null }),
        ])
        expect(projects).toEqual([
            { route: 'a', attempts: 5, lastTried: daysAgo(2).slice(0, 10) },
        ])
    })
})

describe('medianSendIndex', () => {
    it('uses sends of the chosen kind only', () => {
        expect(
            medianSendIndex(
                [tick('top', '6A'), tick('top', '6C'), tick('attempt', '8A')],
                'boulder',
            ),
        ).toBe(gradeIndex('font', '6C'))
        expect(medianSendIndex([], 'route')).toBeNull()
    })
})

describe('ungraded sends', () => {
    const ungraded = (): LogbookTick => tick('top', '', { grade_index: 0 })

    it('never count as the hardest send', () => {
        expect(sessionSummary([ungraded()]).hardest).toEqual([])
    })

    it('do not pull the median grade down', () => {
        expect(
            medianSendIndex(
                [ungraded(), ungraded(), tick('top', '6A')],
                'boulder',
            ),
        ).toBe(15.7)
    })
})

describe('compareLogbooks', () => {
    it('compares stats and splits their sends into shared and new ones', () => {
        const mine = [
            tick('top', '6A', { route: 'a' }),
            tick('flash', '6B', { route: 'b', date: daysAgo(400) }),
        ]
        const theirs = [
            tick('flash', '6A', { route: 'a' }),
            tick('top', '6B', { route: 'b' }),
            tick('top', '7A', { route: 'c' }),
            tick('attempt', '7B', { route: 'd' }),
            tick('top', '6a', { route: 'e', grade_system: 'french' }),
        ]
        const comparison = compareLogbooks(mine, theirs, 'boulder', '12m', NOW)
        expect(comparison.mine.sends).toBe(1)
        expect(comparison.theirs).toMatchObject({ sends: 3, flashes: 1 })
        expect(comparison.theirs.hardest?.grade).toBe('7A')
        expect(comparison.both).toEqual(['a', 'b'])
        expect(comparison.onlyTheirs).toEqual(['c'])
    })
})
