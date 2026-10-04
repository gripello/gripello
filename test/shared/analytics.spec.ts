import { describe, expect, it } from 'vitest'
import {
    buildAnalytics,
    compareGrades,
    gradeScore,
    resolveFilters,
    type AnalyticsRating,
    type AnalyticsRoute,
} from '#shared/utils/analytics'
import { gradeIndex } from '#shared/utils/grades'

const uiaa = (grade: string) => ({
    grade,
    grade_system: 'uiaa',
    grade_index: gradeIndex('uiaa', grade),
})

const NOW = new Date('2026-06-30T12:00:00Z')
const daysAgo = (days: number) =>
    new Date(NOW.getTime() - days * 86_400_000).toISOString()

function route(
    id: string,
    overrides: Partial<AnalyticsRoute> = {},
): AnalyticsRoute {
    return {
        id,
        name: id,
        ...uiaa('6'),
        type: 'Route',
        location: 'hall-a',
        locationName: 'Hall A',
        creator: ['Alice'],
        archived: false,
        screw_date: daysAgo(10),
        ...overrides,
    }
}

let ratingId = 0
function rating(
    routeId: string,
    overrides: Partial<AnalyticsRating> = {},
): AnalyticsRating {
    ratingId += 1
    return {
        id: `rating-${ratingId}`,
        route_id: routeId,
        rating: 4,
        comment: '',
        created: daysAgo(5),
        ...overrides,
    }
}

const allTime = resolveFilters({ range: 'all' }, NOW)

describe('resolveFilters', () => {
    it('defaults to the last 90 days', () => {
        const filters = resolveFilters({}, NOW)
        expect(filters.from?.toISOString()).toBe(daysAgo(90))
        expect(filters.to).toEqual(NOW)
        expect(filters.includeArchived).toBe(false)
    })

    it('has no start for all time and splits list filters', () => {
        const filters = resolveFilters(
            {
                range: 'all',
                location: 'a, b',
                type: 'Boulder',
                archived: 'true',
            },
            NOW,
        )
        expect(filters.from).toBeNull()
        expect(filters.locations).toEqual(['a', 'b'])
        expect(filters.types).toEqual(['Boulder'])
        expect(filters.includeArchived).toBe(true)
    })

    it('covers whole days for a custom range and swaps reversed dates', () => {
        const filters = resolveFilters(
            { range: 'custom', from: '2026-03-10', to: '2026-03-01' },
            NOW,
        )
        expect(filters.from?.toISOString()).toBe('2026-03-01T00:00:00.000Z')
        expect(filters.to.toISOString()).toBe('2026-03-10T23:59:59.999Z')
    })
})

describe('grades', () => {
    it('scores by stored index and falls back to the scale table', () => {
        expect(gradeScore({ grade_index: 13 })).toBe(13)
        expect(gradeScore({ grade: '6a+', grade_system: 'french' })).toBe(12)
        expect(gradeScore({ grade: '', grade_system: 'uiaa' })).toBeNull()
        expect(
            gradeScore({ grade: '', grade_system: 'uiaa', grade_index: 0 }),
        ).toBeNull()
    })

    it('orders minus before plain before plus and unknown last', () => {
        expect(['7', '6+', '?', '6', '6-'].sort(compareGrades)).toEqual([
            '6-',
            '6',
            '6+',
            '7',
            '?',
        ])
    })

    it('orders labels of other scales by difficulty', () => {
        expect(['7a', '6b+', '6a', '5.10a'].sort(compareGrades)).toEqual([
            '5.10a',
            '6a',
            '6b+',
            '7a',
        ])
    })
})

describe('buildAnalytics', () => {
    it('counts the period and compares with the previous one', () => {
        const routes = [
            route('new', { screw_date: daysAgo(5) }),
            route('old', { screw_date: daysAgo(40) }),
            route('older', { screw_date: daysAgo(45) }),
        ]
        const ratings = [
            rating('new', { rating: 5, comment: 'great' }),
            rating('old', { rating: 3, created: daysAgo(40) }),
        ]
        const result = buildAnalytics(
            routes,
            ratings,
            resolveFilters({ range: '30d' }, NOW),
            NOW,
        )

        expect(result.summary.activeRoutes).toBe(3)
        expect(result.summary.routesSet).toEqual({ value: 1, previous: 2 })
        expect(result.summary.ratings).toEqual({ value: 1, previous: 1 })
        expect(result.summary.averageRating).toEqual({ value: 5, previous: 3 })
        expect(result.summary.comments).toEqual({ value: 1, previous: 0 })
        expect(result.summary.unratedRoutes).toBe(1)
        expect(result.bucket).toBe('day')
        expect(result.routeTimeline).toHaveLength(31)
        expect(result.routeTimeline.filter((entry) => entry.count > 0)).toEqual(
            [{ period: daysAgo(5).slice(0, 10), count: 1 }],
        )
        expect(result.latestComments.map((entry) => entry.routeName)).toEqual([
            'new',
        ])
    })

    it('ignores star-only ratings when averaging voted grades', () => {
        const graded = { ...uiaa('7'), rating: 4 }
        const starOnly = { grade: '', grade_system: 'uiaa', grade_index: 0 }
        const result = buildAnalytics(
            [route('a')],
            [
                rating('a', graded),
                rating('a', graded),
                rating('a', graded),
                rating('a', starOnly),
                rating('a', starOnly),
            ],
            allTime,
            NOW,
        )
        expect(result.grades.Route.gradeFeedback[0]).toMatchObject({
            votes: 3,
            votedGrade: 13.4,
            votedGradeLabel: '7',
        })
    })

    it('counts an item at the period start only in the current period', () => {
        const start = '2026-06-01 00:00:00.000Z'
        const result = buildAnalytics(
            [route('a', { screw_date: start })],
            [rating('a', { created: start })],
            resolveFilters(
                { range: 'custom', from: '2026-06-01', to: '2026-06-10' },
                NOW,
            ),
            NOW,
        )
        expect(result.summary.routesSet).toEqual({ value: 1, previous: 0 })
        expect(result.summary.ratings).toEqual({ value: 1, previous: 0 })
    })

    it('has no previous values for all time', () => {
        const result = buildAnalytics([route('a')], [], allTime, NOW)
        expect(result.summary.routesSet.previous).toBeNull()
        expect(result.bucket).toBe('month')
    })

    it('filters by location and type and hides archived routes by default', () => {
        const routes = [
            route('a'),
            route('b', { location: 'hall-b', locationName: 'Hall B' }),
            route('c', { type: 'Boulder' }),
            route('d', { archived: true }),
        ]
        const scoped = buildAnalytics(
            routes,
            [rating('b')],
            resolveFilters(
                { range: 'all', location: 'hall-a', type: 'Route' },
                NOW,
            ),
            NOW,
        )
        expect(scoped.summary.activeRoutes).toBe(1)
        expect(scoped.summary.ratings.value).toBe(0)
        expect(scoped.grades.Route.gradeDistribution[0]!.total).toBe(1)
        expect(scoped.grades.Boulder.gradeDistribution).toEqual([])

        const withArchived = buildAnalytics(
            routes,
            [],
            resolveFilters({ range: 'all', archived: 'true' }, NOW),
            NOW,
        )
        expect(withArchived.grades.Route.gradeDistribution[0]!.total).toBe(3)
        expect(withArchived.grades.Boulder.gradeDistribution[0]!.total).toBe(1)
    })

    it('leaves archived routes and their ratings out unless included', () => {
        const routes = [
            route('a', { creator: ['Active'] }),
            route('b', {
                creator: ['Retired'],
                archived: true,
                archived_at: daysAgo(1),
            }),
        ]
        const ratings = [rating('a'), rating('b')]

        const hidden = buildAnalytics(routes, ratings, allTime, NOW)
        expect(hidden.summary.routesSet.value).toBe(1)
        expect(hidden.summary.ratings.value).toBe(1)
        expect(hidden.setters.map((entry) => entry.setter)).toEqual(['Active'])
        expect(hidden.summary.averageLifespanDays).not.toBeNull()

        const shown = buildAnalytics(
            routes,
            ratings,
            resolveFilters({ range: 'all', archived: 'true' }, NOW),
            NOW,
        )
        expect(shown.summary.routesSet.value).toBe(2)
        expect(shown.summary.ratings.value).toBe(2)
        expect(shown.setters).toHaveLength(2)
    })

    it('uses archived_at for the lifespan', () => {
        const routes = [
            route('a', {
                archived: true,
                screw_date: daysAgo(40),
                archived_at: daysAgo(10),
            }),
            route('b', {
                archived: true,
                screw_date: daysAgo(30),
                archived_at: null,
            }),
        ]
        expect(
            buildAnalytics(routes, [], allTime, NOW).summary
                .averageLifespanDays,
        ).toBe(30)
    })

    it('lists routes whose grade votes deviate from the set grade', () => {
        const votes = (routeId: string, grade: string) =>
            [1, 2, 3].map(() => rating(routeId, uiaa(grade)))
        const routes = [
            route('sandbag'),
            route('soft'),
            route('fair'),
            route('few'),
        ]
        const ratings = [
            ...votes('sandbag', '7'),
            ...votes('soft', '5'),
            ...votes('fair', '6'),
            rating('few', uiaa('9')),
        ]
        const result = buildAnalytics(routes, ratings, allTime, NOW)

        expect(
            result.grades.Route.gradeFeedback.map(
                ({ id, setGrade, votedGrade, deviation }) => ({
                    id,
                    setGrade,
                    votedGrade,
                    deviation,
                }),
            ),
        ).toEqual([
            { id: 'sandbag', setGrade: 10.1, votedGrade: 13.4, deviation: 3.3 },
            { id: 'soft', setGrade: 10.1, votedGrade: 7.4, deviation: -2.7 },
            { id: 'fair', setGrade: 10.1, votedGrade: 10.1, deviation: 0 },
        ])
        expect(result.setters[0]).toMatchObject({
            setter: 'Alice',
            routes: 4,
            routesInPeriod: 4,
            averageDeviation: 0.2,
        })
    })

    it('reports grades that are under-represented compared with history', () => {
        const routes = [
            ...[1, 2, 3, 4].map((index) => route(`six-${index}`)),
            ...[1, 2, 3, 4].map((index) =>
                route(`seven-old-${index}`, { ...uiaa('7'), archived: true }),
            ),
            route('seven-active', { ...uiaa('7') }),
        ]
        const result = buildAnalytics(routes, [], allTime, NOW)
        expect(result.grades.Route.gradeDistribution).toEqual([
            { grade: '6', total: 4, expected: 2.2 },
            { grade: '7', total: 1, expected: 2.8 },
        ])
    })

    it('puts boulders and routes on separate grade axes', () => {
        const routes = [
            route('uiaa-five', uiaa('5')),
            route('font-five', {
                type: 'Boulder',
                grade: '5',
                grade_system: 'font',
                grade_index: gradeIndex('font', '5'),
            }),
        ]
        const result = buildAnalytics(routes, [], allTime, NOW)
        const labels = (rows: { grade: string }[]) =>
            rows.map((row) => row.grade)
        expect(labels(result.grades.Route.gradeDistribution)).toEqual(['5'])
        expect(labels(result.grades.Boulder.gradeDistribution)).toEqual(['5'])
        expect(result.grades.Boulder.locationGrades).toEqual([
            { location: 'Hall A', grade: '5', count: 1 },
        ])
    })

    it('counts stars, comments per bucket and grades per location', () => {
        const routes = [
            route('a'),
            route('b', {
                location: 'hall-b',
                locationName: 'Hall B',
                ...uiaa('7'),
            }),
        ]
        const ratings = [
            rating('a', { rating: 5, comment: 'nice' }),
            rating('a', { rating: 5 }),
            rating('b', { rating: 1 }),
        ]
        const result = buildAnalytics(routes, ratings, allTime, NOW)
        expect(result.ratingDistribution).toEqual([1, 0, 0, 0, 2])
        expect(result.commentTimeline).toEqual([
            { period: '2026-06', count: 1 },
        ])
        expect(result.grades.Route.locationGrades).toEqual([
            { location: 'Hall A', grade: '6', count: 1 },
            { location: 'Hall B', grade: '7', count: 1 },
        ])
    })

    it('ages the oldest active routes', () => {
        const result = buildAnalytics(
            [route('new'), route('old', { screw_date: daysAgo(200) })],
            [],
            allTime,
            NOW,
        )
        expect(
            result.oldestActive.map(({ id, ageDays }) => ({ id, ageDays })),
        ).toEqual([
            { id: 'old', ageDays: 200 },
            { id: 'new', ageDays: 10 },
        ])
    })

    it('leaves permanent routes out of age statistics but keeps them counted', () => {
        const routes = [
            route('new'),
            route('structure', { screw_date: daysAgo(7000), permanent: true }),
            route('gone', {
                archived: true,
                screw_date: daysAgo(40),
                archived_at: daysAgo(10),
            }),
            route('goneStructure', {
                archived: true,
                permanent: true,
                screw_date: daysAgo(5000),
                archived_at: daysAgo(10),
            }),
        ]
        const result = buildAnalytics(routes, [], allTime, NOW)

        expect(result.oldestActive.map(({ id }) => id)).toEqual(['new'])
        expect(result.summary.averageLifespanDays).toBe(30)
        expect(result.grades.Route.gradeDistribution[0]!.total).toBe(2)
    })

    it('keeps top and lowest rated lists disjoint', () => {
        const routes = ['a', 'b'].map((id) => route(id))
        const ratings = [
            ...[1, 2, 3].map(() => rating('a', { rating: 5 })),
            ...[1, 2, 3].map(() => rating('b', { rating: 2 })),
        ]
        const result = buildAnalytics(routes, ratings, allTime, NOW)
        expect(result.topRated.map((entry) => entry.id)).toEqual(['a', 'b'])
        expect(result.lowestRated).toEqual([])
        expect(result.ratingBaseline).toBe(3.5)
    })
})
