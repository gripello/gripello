import { describe, expect, it } from 'vitest'
import {
    gradeSpread,
    isNewRoute,
    newRoutes,
    popularRoutes,
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

describe('gradeSpread', () => {
    it('counts per grade between the easiest and hardest used grade', () => {
        const grades = ['4', '5', '6', '7', '8']
        const routes = [
            route('a', { grade: '5' }),
            route('b', { grade: '7' }),
            route('c', { grade: '7' }),
            route('d', { grade: 'x' }),
        ]
        expect(gradeSpread(routes, grades)).toEqual([
            { grade: '5', count: 1 },
            { grade: '6', count: 0 },
            { grade: '7', count: 2 },
        ])
        expect(gradeSpread([], grades)).toEqual([])
    })
})

describe('wallSummaries', () => {
    it('summarises count, grade range and newest set date per wall', () => {
        const walls = [
            { id: 'w2', name: 'Island', location: 'l', sort: 2 },
            { id: 'w1', name: 'North', location: 'l', sort: 1 },
        ]
        const routes = [
            route('a', {
                wall: 'w1',
                grade: '6',
                grade_index: 10,
                screw_date: '2026-09-01',
            }),
            route('b', {
                wall: 'w1',
                grade: '5',
                grade_index: 7,
                screw_date: '2026-09-20',
            }),
            route('c', {
                wall: 'w1',
                type: 'Boulder',
                grade: '6A',
                grade_index: 15.7,
                screw_date: '2026-09-02',
            }),
        ]
        expect(wallSummaries(walls, routes)).toEqual([
            {
                id: 'w1',
                name: 'North',
                location: 'l',
                count: 3,
                ranges: [
                    { type: 'Boulder', easiest: '6A', hardest: '6A' },
                    { type: 'Route', easiest: '5', hardest: '6' },
                ],
                newest: '2026-09-20',
            },
            {
                id: 'w2',
                name: 'Island',
                location: 'l',
                count: 0,
                ranges: [],
                newest: null,
            },
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
