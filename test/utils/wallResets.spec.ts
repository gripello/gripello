import { describe, expect, it } from 'vitest'
import {
    defaultRemovalSelection,
    heatColor,
    heatLevel,
    ageUnit,
    oldestHalf,
    percentileRanks,
    resetContext,
    resetFlags,
    resetScore,
    routeAgeDays,
    routeUrgency,
    wallResetRows,
    weeksFromToday,
    type RouteStats,
} from '~/utils/wallResets'
import type { WallRecord } from '~/types/models'

const now = new Date('2026-10-12T00:00:00Z')
const wall = (id: string) => ({ id }) as WallRecord
const stat = (patch: Partial<RouteStats> = {}): RouteStats => ({
    ticks: 10,
    recent_ticks: 8,
    average_rating: 4,
    ratings: 5,
    grade_deviation: 0,
    open_defects: 0,
    ...patch,
})
const boulder = (id: string, screw_date: string, patch = {}) => ({
    id,
    type: 'Boulder',
    wall: 'w',
    screw_date,
    ...patch,
})

describe('routeAgeDays', () => {
    it('counts from the screw date, else creation', () => {
        expect(routeAgeDays({ id: 'a', screw_date: '2026-10-02' }, now)).toBe(
            10,
        )
        expect(
            routeAgeDays({ id: 'a', created: '2026-10-11T00:00:00Z' }, now),
        ).toBe(1)
        expect(routeAgeDays({ id: 'a' }, now)).toBeNull()
    })
})

describe('resetContext', () => {
    it('calls the oldest quarter of the location old, never below the discipline minimum', () => {
        const old = [100, 200, 300, 400, 500].map((days, index) =>
            boulder(
                `o${index}`,
                new Date(now.getTime() - days * 86_400_000).toISOString(),
            ),
        )
        expect(
            resetContext(old, new Map(), now).oldAfterDays.get('Boulder'),
        ).toBe(400)
        const fresh = [boulder('f', '2026-10-01')]
        expect(
            resetContext(fresh, new Map(), now).oldAfterDays.get('Boulder'),
        ).toBe(42)
    })

    it('takes the median recent traffic of settled routes', () => {
        const routes = [
            boulder('a', '2026-09-01'),
            boulder('b', '2026-09-01'),
            boulder('c', '2026-09-01'),
            boulder('fresh', '2026-10-10'),
        ]
        const stats = new Map([
            ['a', stat({ recent_ticks: 2 })],
            ['b', stat({ recent_ticks: 6 })],
            ['c', stat({ recent_ticks: 10 })],
            ['fresh', stat({ recent_ticks: 50 })],
        ])
        expect(
            resetContext(routes, stats, now).typicalRecentTicks.get('Boulder'),
        ).toBe(6)
    })
})

describe('resetFlags', () => {
    const context = {
        oldAfterDays: new Map([['Boulder' as const, 90]]),
        typicalRecentTicks: new Map([['Boulder' as const, 8]]),
    }

    it('leaves busy, liked, younger routes alone', () => {
        expect(
            resetFlags(boulder('r', '2026-09-20'), stat(), context, now),
        ).toEqual([])
    })

    it('flags age, defects, empty and thin traffic, low stars and grade disagreement', () => {
        expect(
            resetFlags(
                boulder('r', '2026-06-01'),
                stat({
                    open_defects: 1,
                    average_rating: 2,
                    grade_deviation: -1.2,
                }),
                context,
                now,
            ),
        ).toEqual(['defect', 'old', 'disliked', 'gradeOff'])
        expect(
            resetFlags(
                boulder('r', '2026-09-01'),
                stat({ recent_ticks: 0 }),
                context,
                now,
            ),
        ).toEqual(['stale'])
        expect(
            resetFlags(
                boulder('r', '2026-09-20'),
                stat({ recent_ticks: 1 }),
                context,
                now,
            ),
        ).toEqual(['quiet'])
    })

    it('ignores empty months where climbers rarely log', () => {
        const quietGym = {
            ...context,
            typicalRecentTicks: new Map([['Boulder' as const, 0]]),
        }
        expect(
            resetFlags(
                boulder('r', '2026-09-01'),
                stat({ recent_ticks: 0 }),
                quietGym,
                now,
            ),
        ).toEqual([])
    })

    it('waits for enough reviews and a settled route', () => {
        expect(
            resetFlags(
                boulder('r', '2026-09-20'),
                stat({ ratings: 2, average_rating: 1 }),
                context,
                now,
            ),
        ).toEqual([])
        expect(
            resetFlags(
                boulder('r', '2026-10-05'),
                stat({ recent_ticks: 0 }),
                context,
                now,
            ),
        ).toEqual([])
    })

    it('never flags permanent features', () => {
        expect(
            resetFlags(
                boulder('r', '2020-01-01', { permanent: true }),
                stat({ open_defects: 2 }),
                context,
                now,
            ),
        ).toEqual([])
    })

    it('weights the flags into a score', () => {
        expect(resetScore(['old', 'quiet'])).toBe(4)
    })
})

describe('urgency and heat', () => {
    it('ranks values from 0 to 1 with ties sharing their middle rank', () => {
        expect(
            percentileRanks(
                new Map([
                    ['a', 5],
                    ['b', 1],
                    ['c', 5],
                ]),
            ),
        ).toEqual(
            new Map([
                ['a', 0.75],
                ['b', 0],
                ['c', 0.75],
            ]),
        )
        expect(percentileRanks(new Map([['a', 5]]))).toEqual(
            new Map([['a', 0.5]]),
        )
    })

    it('puts flagged routes above older unflagged ones', () => {
        const routes = [
            boulder('older', '2026-01-01'),
            boulder('flagged', '2026-06-01'),
            boulder('young', '2026-10-01'),
        ]
        const urgency = routeUrgency(
            routes,
            (route) => (route.id === 'flagged' ? ['defect', 'disliked'] : []),
            now,
        )
        expect(urgency.get('flagged')).toBe(1)
        expect(urgency.get('young')).toBe(0)
    })

    it('spreads walls from green to red within the location', () => {
        const routes = [
            boulder('a1', '2026-01-01', { wall: 'a' }),
            boulder('b1', '2026-09-01', { wall: 'b' }),
            boulder('c1', '2026-05-01', { wall: 'c' }),
        ]
        const urgency = routeUrgency(routes, () => [], now)
        const rows = wallResetRows(
            [wall('a'), wall('b'), wall('c'), wall('empty')],
            routes,
            {
                now,
                urgency,
            },
        )
        expect(rows.map((row) => [row.wall.id, row.heat])).toEqual([
            ['a', 1],
            ['c', 0.5],
            ['b', 0],
            ['empty', 0],
        ])
        expect(heatColor(0)).toContain('0%')
        expect(heatColor(1)).toContain('var(--ui-error) 100%')
    })
})

describe('wallResetRows', () => {
    it('lists walls with planned removals first, soonest first', () => {
        const rows = wallResetRows(
            [wall('a'), wall('b'), wall('c')],
            [
                { id: 'c1', wall: 'c', removal_planned_for: '2026-11-02' },
                { id: 'c2', wall: 'c', removal_planned_for: '2026-10-20' },
                { id: 'a2', wall: 'a', removal_planned_for: '2026-12-01' },
                { id: 'b1', wall: 'b' },
            ],
            { now },
        )
        expect(
            rows.map((row) => [
                row.wall.id,
                row.plannedFor,
                row.planned.length,
            ]),
        ).toEqual([
            ['c', '2026-10-20', 2],
            ['a', '2026-12-01', 1],
            ['b', null, 0],
        ])
    })
})

describe('selection presets', () => {
    it('keeps the current plan, else the flagged routes, else every non-permanent route', () => {
        const flagged = wallResetRows(
            [wall('w')],
            [boulder('a', '2026-01-01'), boulder('b', '2026-09-01')],
            { now, flagsOf: (route) => (route.id === 'a' ? ['old'] : []) },
        )[0]!
        expect([...defaultRemovalSelection(flagged)]).toEqual(['a'])
        const plain = wallResetRows(
            [wall('w')],
            [
                boulder('a', '2026-01-01'),
                boulder('p', '2020-01-01', { permanent: true }),
            ],
            { now },
        )[0]!
        expect([...defaultRemovalSelection(plain)]).toEqual(['a'])
        const planned = wallResetRows(
            [wall('w')],
            [
                boulder('a', '2026-01-01'),
                boulder('b', '2026-09-01', {
                    removal_planned_for: '2026-11-02',
                }),
            ],
            { now, flagsOf: () => ['old'] },
        )[0]!
        expect([...defaultRemovalSelection(planned)]).toEqual(['b'])
    })

    it('picks the older half of the non-permanent routes', () => {
        const [row] = wallResetRows(
            [wall('w')],
            [
                boulder('new', '2026-10-10'),
                boulder('old', '2026-01-01'),
                boulder('mid', '2026-06-01'),
                boulder('arete', '2020-01-01', { permanent: true }),
            ],
            { now },
        )
        expect([...oldestHalf(row!, now)]).toEqual(['old', 'mid'])
    })
})

describe('heatLevel', () => {
    it('splits the location into thirds', () => {
        expect([0, 0.4, 0.9].map(heatLevel)).toEqual(['low', 'medium', 'high'])
    })
})

describe('weeksFromToday', () => {
    it('adds whole weeks in local time', () => {
        expect(weeksFromToday(2, new Date(2026, 9, 12))).toBe('2026-10-26')
    })
})

describe('ageUnit', () => {
    it('switches to months and years for long ages', () => {
        expect(ageUnit(45)).toEqual({ key: 'days', n: 45 })
        expect(ageUnit(213)).toEqual({ key: 'months', n: 7 })
        expect(ageUnit(7377)).toEqual({ key: 'years', n: 20 })
    })
})
