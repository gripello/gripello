import { describe, expect, it } from 'vitest'
import {
    gradeAxis,
    isNewRoute,
    newRoutes,
    popularRoutes,
    railDots,
    sentShare,
    wallSummaries,
} from '~/utils/overview'

const NOW = new Date('2026-09-27T12:00:00Z')
const route = (id: string, patch: Record<string, unknown> = {}) => ({
    id,
    name: id,
    ...patch,
})

describe('newRoutes', () => {
    it('keeps routes set in the last two weeks, newest first', () => {
        const routes = [
            route('old', { screw_date: '2026-08-01' }),
            route('week', { screw_date: '2026-09-20' }),
            route('today', { screw_date: '2026-09-27' }),
            route('undated'),
        ]
        expect(newRoutes(routes, NOW).map((r) => r.id)).toEqual([
            'today',
            'week',
        ])
    })
})

describe('isNewRoute', () => {
    it('flags routes set within 14 days, not far-future dates', () => {
        expect(isNewRoute({ screw_date: '2026-09-14' }, NOW)).toBe(true)
        expect(isNewRoute({ screw_date: '2026-09-13' }, NOW)).toBe(false)
        expect(isNewRoute({ screw_date: '2026-10-05' }, NOW)).toBe(false)
        expect(isNewRoute({ screw_date: null }, NOW)).toBe(false)
    })
})

describe('popularRoutes', () => {
    it('ranks by rating and ignores routes with too few ratings', () => {
        const routes = [
            route('a', { average_rating: 4, ratings_count: 5 }),
            route('b', { average_rating: 5, ratings_count: 1 }),
            route('c', { average_rating: 4.5, ratings_count: 2 }),
            route('d', { average_rating: 4, ratings_count: 9 }),
        ]
        expect(popularRoutes(routes, 2).map((r) => r.id)).toEqual(['c', 'd'])
    })
})

describe('wallSummaries', () => {
    it("keeps each wall's routes in wall order and counts the fresh ones", () => {
        const walls = [
            { id: 'w2', name: 'Island', location: 'l', sort: 2 },
            { id: 'w1', name: 'North', location: 'l', sort: 1 },
        ]
        const routes = [
            route('a', { wall: 'w1', screw_date: '2026-09-01' }),
            route('b', { wall: 'w1', screw_date: '2026-09-20' }),
            route('c', { wall: 'w3', screw_date: '2026-09-25' }),
        ]
        expect(wallSummaries(walls, routes, NOW)).toEqual([
            {
                id: 'w1',
                name: 'North',
                location: 'l',
                routes: [routes[0], routes[1]],
                fresh: 1,
            },
            { id: 'w2', name: 'Island', location: 'l', routes: [], fresh: 0 },
        ])
    })
})

describe('gradeAxis', () => {
    it("spans the used grades and labels whole grades of the viewer's system", () => {
        const axis = gradeAxis([4.6, 7.4, 13.4], 'uiaa')!
        expect(axis.min).toBeCloseTo(4)
        expect(axis.max).toBeCloseTo(14)
        expect(axis.ticks.map((tick) => tick.label)).toEqual([
            '4',
            '5',
            '6',
            '7',
        ])
        expect(axis.ticks[0]!.at).toBeCloseTo(0.06)
    })

    it('thins the labels to at most six', () => {
        const axis = gradeAxis([1, 30], 'uiaa')!
        expect(axis.ticks.length).toBeLessThanOrEqual(6)
    })

    it('has no axis without graded routes', () => {
        expect(gradeAxis([], 'font')).toBeNull()
    })
})

describe('railDots', () => {
    it('places routes at their grade, stacks equal grades and flags new ones', () => {
        const axis = { min: 0, max: 10, ticks: [] }
        const dots = railDots(
            [
                route('hard', { grade_index: 8, screw_date: '2026-09-25' }),
                route('easy', { grade_index: 2, screw_date: '2026-01-01' }),
                route('easy2', { grade_index: 2 }),
                route('ungraded'),
            ],
            axis,
            NOW,
        )
        expect(dots).toEqual([
            { id: 'easy', at: 0.2, level: 0, fresh: false },
            { id: 'easy2', at: 0.2, level: 1, fresh: false },
            { id: 'hard', at: 0.8, level: 0, fresh: true },
        ])
    })
})

describe('sentShare', () => {
    it('counts the current routes a climber has sent', () => {
        expect(
            sentShare(
                [route('a'), route('b'), route('c')],
                new Set(['b', 'x']),
            ),
        ).toEqual({ sent: 1, total: 3 })
    })
})
