import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    resetSoleGymCache,
    soleActiveGymSlug,
} from '../../server/utils/legacyGymPaths'

describe('soleActiveGymSlug', () => {
    beforeEach(() => resetSoleGymCache())

    it('returns the slug when exactly one gym is active', async () => {
        expect(await soleActiveGymSlug(async () => ['gym-a'])).toBe('gym-a')
    })

    it('returns nothing for zero or several gyms', async () => {
        expect(await soleActiveGymSlug(async () => [])).toBe('')
        resetSoleGymCache()
        expect(await soleActiveGymSlug(async () => ['a', 'b'])).toBe('')
    })

    it('caches the answer for a minute', async () => {
        const load = vi.fn(async () => ['gym-a'])
        await soleActiveGymSlug(load, 0)
        await soleActiveGymSlug(load, 59_999)
        expect(load).toHaveBeenCalledTimes(1)
        await soleActiveGymSlug(load, 60_000)
        expect(load).toHaveBeenCalledTimes(2)
    })

    it('does not cache a failed lookup', async () => {
        expect(
            await soleActiveGymSlug(async () => {
                throw new Error('down')
            }),
        ).toBe('')
        expect(await soleActiveGymSlug(async () => ['gym-a'])).toBe('gym-a')
    })
})
