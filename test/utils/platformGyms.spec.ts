import { describe, expect, it } from 'vitest'
import { platformTotals, withGymStats } from '~/utils/platformGyms'

describe('withGymStats', () => {
    it('adds member and route counts, zero when a gym has no stats', () => {
        const gyms = withGymStats(
            [
                { id: 'a', slug: 'a', name: 'A', active: true },
                { id: 'b', slug: 'b', name: 'B', active: false },
            ],
            [{ id: 'a', members: 3, routes: 40 }],
        )
        expect(gyms).toEqual([
            expect.objectContaining({ id: 'a', members: 3, routes: 40 }),
            expect.objectContaining({ id: 'b', members: 0, routes: 0 }),
        ])
        expect(platformTotals(gyms)).toEqual({
            gyms: 2,
            activeGyms: 1,
            members: 3,
            routes: 40,
        })
    })
})
