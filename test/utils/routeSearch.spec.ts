import { describe, expect, it } from 'vitest'
import { routeFilterQuery, routeSearchQuery } from '~/utils/routeSearch'

describe('routeSearchQuery', () => {
    it('returns an empty query for blank input', () => {
        expect(routeSearchQuery('   ')).toEqual({})
    })

    it('matches text against name and setter', () => {
        expect(routeSearchQuery('Funk')).toEqual({ q: 'Funk' })
    })

    it('keeps words and plain numbers together as one phrase', () => {
        expect(routeSearchQuery('Setter  3')).toEqual({ q: 'Setter 3' })
    })

    it('treats a lone number as a grade level with its signs', () => {
        expect(routeSearchQuery('6')).toEqual({ grade: ['6-', '6', '6+'] })
    })

    it('searches text for a lone number that is no grade', () => {
        expect(routeSearchQuery('99')).toEqual({ q: '99' })
    })

    it('treats signed grades as grade filters', () => {
        expect(routeSearchQuery('Funk 7+')).toEqual({
            q: 'Funk',
            grade: ['7+'],
        })
        expect(routeSearchQuery('5-')).toEqual({ grade: ['5-'] })
    })

    it('recognises grades of every scale, case-insensitively', () => {
        expect(routeSearchQuery('Funk 5.10a')).toEqual({
            q: 'Funk',
            grade: ['5.10a'],
        })
        expect(routeSearchQuery('v5')).toEqual({ grade: ['V5'] })
        expect(routeSearchQuery('6a+')).toEqual({ grade: ['6a+', '6A+'] })
    })
})

describe('routeFilterQuery', () => {
    const empty = {
        difficulty: '',
        location: '',
        wall: '',
        type: '',
        search: '',
    }

    it('is empty without filters', () => {
        expect(routeFilterQuery(empty)).toEqual({})
    })

    it('combines the selected filters with the search', () => {
        expect(
            routeFilterQuery({
                difficulty: 'font:6a',
                location: 'l1',
                wall: 'w1',
                type: 'Boulder',
                search: 'Funk',
            }),
        ).toEqual({
            q: 'Funk',
            grade_system: 'font',
            grade: ['6a'],
            location: 'l1',
            wall: 'w1',
            type: 'Boulder',
        })
    })

    it('keeps the selected grade when the search names it too', () => {
        expect(
            routeFilterQuery({ ...empty, difficulty: 'font:6a', search: '6a' }),
        ).toEqual({ grade_system: 'font', grade: ['6a'] })
    })

    it('matches nothing when the search names another grade', () => {
        expect(
            routeFilterQuery({ ...empty, difficulty: 'font:6a', search: '7a' }),
        ).toEqual({ grade_system: 'font', grade: [] })
    })
})
