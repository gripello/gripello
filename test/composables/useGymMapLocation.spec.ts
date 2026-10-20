import { describe, expect, it } from 'vitest'
import { defaultMapLocation } from '~/composables/useGymMapLocation'

const plan = {
    width: 20,
    height: 10,
    shapes: [
        {
            kind: 'floor',
            points: [
                [0, 0],
                [5, 0],
                [5, 5],
                [0, 5],
            ],
        },
    ],
}

describe('defaultMapLocation', () => {
    it('prefers the first location with a floor plan', () => {
        expect(
            defaultMapLocation([
                { id: 'empty', map: { width: 20, height: 10, shapes: [] } },
                { id: 'none' },
                { id: 'hall', map: plan },
            ]),
        ).toBe('hall')
    })

    it('falls back to the first location', () => {
        expect(defaultMapLocation([{ id: 'a' }, { id: 'b' }])).toBe('a')
        expect(defaultMapLocation([])).toBe('')
    })
})
