import { describe, it, expect } from 'vitest'
import { toSortParam } from '~/utils/sorting'

describe('toSortParam', () => {
    it('returns the default sort when no array is given', () => {
        expect(toSortParam([])).toBe('-created')
    })

    it('respects a custom default sort', () => {
        expect(toSortParam([], '-screw_date')).toBe('-screw_date')
    })

    it('converts a single desc sort to a prefixed key', () => {
        expect(toSortParam([{ key: 'name', order: 'desc' }])).toBe('-name')
    })

    it('converts a single asc sort to a plain key', () => {
        expect(toSortParam([{ key: 'name', order: 'asc' }])).toBe('name')
    })

    it('joins multiple sort fields with commas', () => {
        expect(
            toSortParam([
                { key: 'difficulty', order: 'asc' },
                { key: 'name', order: 'desc' },
            ]),
        ).toBe('difficulty,-name')
    })

    it('keeps grouping fields of a mapped key ascending', () => {
        const keyMap = { difficulty: 'type,grade_index' }
        expect(
            toSortParam([{ key: 'difficulty', order: 'desc' }], '', keyMap),
        ).toBe('type,-grade_index')
        expect(
            toSortParam([{ key: 'difficulty', order: 'asc' }], '', keyMap),
        ).toBe('type,grade_index')
    })

    it('treats a missing order as ascending (no dash prefix)', () => {
        expect(toSortParam([{ key: 'name' }])).toBe('name')
    })

    it('returns the default sort when called with undefined', () => {
        // @ts-expect-error intentional bad input
        expect(toSortParam(undefined)).toBe('-created')
    })

    it('returns the default sort when called with null', () => {
        // @ts-expect-error intentional bad input
        expect(toSortParam(null)).toBe('-created')
    })

    it('maps column keys to field names via keyMap', () => {
        expect(
            toSortParam([{ key: 'score', order: 'asc' }], '-created', {
                score: 'average_rating',
            }),
        ).toBe('average_rating')
    })

    it('keeps the desc prefix on mapped keys', () => {
        expect(
            toSortParam([{ key: 'score', order: 'desc' }], '-created', {
                score: 'average_rating',
            }),
        ).toBe('-average_rating')
    })

    it('leaves keys not present in keyMap untouched', () => {
        expect(
            toSortParam(
                [
                    { key: 'name', order: 'asc' },
                    { key: 'score', order: 'desc' },
                ],
                '-created',
                { score: 'average_rating' },
            ),
        ).toBe('name,-average_rating')
    })
})
