import { describe, expect, it } from 'vitest'
import {
    filterPlatformGyms,
    platformTotals,
    withGymStats,
    type PlatformGymStatus,
} from '~/utils/platformGyms'

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

describe('filterPlatformGyms', () => {
    const gyms = withGymStats(
        [
            { id: 'a', slug: 'boulderwelt', name: 'Boulderwelt', active: true },
            { id: 'b', slug: 'kh-nord', name: 'Kletterhalle', active: false },
            { id: 'c', slug: 'demo', name: 'Demo', active: true, hidden: true },
            { id: 'd', slug: 'old', name: 'Old', active: false, hidden: true },
        ],
        [],
    )
    const ids = (query: string, status: PlatformGymStatus) =>
        filterPlatformGyms(gyms, query, status).map((gym) => gym.id)

    it('matches name or slug, case-insensitive', () => {
        expect(ids('BOULDER', 'all')).toEqual(['a'])
        expect(ids('nord', 'all')).toEqual(['b'])
        expect(ids('  ', 'all')).toEqual(['a', 'b', 'c', 'd'])
    })

    it('filters by status', () => {
        expect(ids('', 'active')).toEqual(['a', 'c'])
        expect(ids('', 'offline')).toEqual(['b', 'd'])
        expect(ids('', 'hidden')).toEqual(['c'])
    })
})
