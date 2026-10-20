import { describe, expect, it } from 'vitest'
import fixture from '../../backend/testdata/analytics.json'
import {
    compareGrades,
    gradeScore,
    labelAnalytics,
    routeAge,
    type AnalyticsPayload,
    type AnalyticsResponse,
} from '#shared/utils/analytics'

const RESPONSE_KEYS: (keyof AnalyticsResponse)[] = [
    'generatedAt',
    'period',
    'bucket',
    'summary',
    'grades',
    'routeTimeline',
    'ratingTimeline',
    'commentTimeline',
    'dailyRouteActivity',
    'ratingDistribution',
    'setters',
    'ratingBaseline',
    'topRated',
    'lowestRated',
    'oldestActive',
    'latestComments',
]

const payloads = fixture.cases.map(
    ({ name, expected }) => [name, expected as AnalyticsPayload] as const,
)
const byName = Object.fromEntries(payloads)

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

describe('labelAnalytics', () => {
    it.each(payloads)('%s has the response shape', (_name, payload) => {
        expect(Object.keys(payload).sort()).toEqual([...RESPONSE_KEYS].sort())
        expect(Object.keys(payload.grades).sort()).toEqual(['Boulder', 'Route'])
    })

    it.each(payloads)(
        '%s sorts grade buckets by difficulty',
        (_name, payload) => {
            const shuffled = {
                ...payload,
                grades: {
                    Boulder: {
                        ...payload.grades.Boulder,
                        gradeDistribution: [
                            ...payload.grades.Boulder.gradeDistribution,
                        ].reverse(),
                    },
                    Route: {
                        ...payload.grades.Route,
                        gradeDistribution: [
                            ...payload.grades.Route.gradeDistribution,
                        ].reverse(),
                    },
                },
            }
            const labelled = labelAnalytics(shuffled)
            expect(labelled.grades.Boulder.gradeDistribution).toEqual(
                payload.grades.Boulder.gradeDistribution,
            )
            expect(labelled.grades.Route.gradeDistribution).toEqual(
                payload.grades.Route.gradeDistribution,
            )
        },
    )

    it('labels voted grades in the grade system of the route', () => {
        const labelled = labelAnalytics(
            byName['star-only ratings are left out of voted grades']!,
        )
        expect(labelled.grades.Route.gradeFeedback[0]).toMatchObject({
            votes: 3,
            votedGrade: 13.4,
            votedGradeLabel: '7',
        })

        const mixed = labelAnalytics(byName['several grade systems']!)
        const labels = Object.fromEntries(
            [
                ...mixed.grades.Route.gradeFeedback,
                ...mixed.grades.Boulder.gradeFeedback,
            ].map((row) => [row.id, row.votedGradeLabel]),
        )
        expect(labels).toEqual({
            u6: '7',
            f6a: '6b',
            f7a: '6c+',
            font: '7A',
            hueco: 'V2',
        })
    })

    it('leaves the label empty for an unknown grade system', () => {
        const payload =
            byName['star-only ratings are left out of voted grades']!
        const row = {
            ...payload.grades.Route.gradeFeedback[0]!,
            gradeSystem: '',
        }
        const labelled = labelAnalytics({
            ...payload,
            grades: {
                ...payload.grades,
                Route: { ...payload.grades.Route, gradeFeedback: [row] },
            },
        })
        expect(labelled.grades.Route.gradeFeedback[0]!.votedGradeLabel).toBe('')
    })
})

describe('routeAge', () => {
    it('picks a readable unit', () => {
        expect(routeAge(12)).toEqual({ unit: 'days', n: 12 })
        expect(routeAge(200)).toEqual({ unit: 'months', n: 7 })
        expect(routeAge(7384)).toEqual({ unit: 'years', n: 20 })
    })
})
