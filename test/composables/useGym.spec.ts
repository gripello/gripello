import { beforeEach, describe, expect, it, vi } from 'vitest'
import type PocketBase from 'pocketbase'
import {
    findGym,
    loadGym,
    routeGymSlug,
    routeParam,
} from '~/composables/useGym'

vi.stubGlobal(
    'createError',
    (input: { statusCode: number; statusMessage: string }) =>
        Object.assign(new Error(input.statusMessage), input),
)

const gyms = [
    {
        id: 'g1',
        slug: 'first',
        name: 'First',
        active: true,
        previous_slugs: ['erste'],
    },
    { id: 'g2', slug: 'second', name: 'Second', active: true },
    { id: 'g3', slug: 'closed', name: 'Closed', active: false },
]

const getFirstListItem = vi.fn()
const pb = {
    filter: (raw: string, params: { slug: string }) =>
        raw.replace('{:slug}', JSON.stringify(params.slug)),
    collection: () => ({ getFirstListItem }),
} as unknown as PocketBase

describe('loadGym', () => {
    beforeEach(() => {
        getFirstListItem.mockReset().mockImplementation(async (filter) => {
            const gym = gyms.find(
                (g) =>
                    g.active &&
                    (filter === `slug = "${g.slug}" && active = true` ||
                        g.previous_slugs?.some(
                            (previous) =>
                                filter ===
                                `previous_slugs ~ ${JSON.stringify(JSON.stringify(previous))} && active = true`,
                        )),
            )
            if (!gym) throw Object.assign(new Error('missing'), { status: 404 })
            return gym
        })
    })

    it('prefers the gym named in the route over the cookie', async () => {
        expect(await loadGym(pb, 'second', 'first')).toMatchObject({ id: 'g2' })
    })

    it('rejects an unknown or inactive route slug with 404', async () => {
        await expect(loadGym(pb, 'nope', '')).rejects.toMatchObject({
            statusCode: 404,
        })
        await expect(loadGym(pb, 'closed', '')).rejects.toMatchObject({
            statusCode: 404,
        })
    })

    it('uses the cookie when the route has no gym', async () => {
        expect(await loadGym(pb, '', 'second')).toMatchObject({ id: 'g2' })
    })

    it('returns null without route slug and cookie or for a stale cookie', async () => {
        expect(await loadGym(pb, '', '')).toBeNull()
        expect(await loadGym(pb, '', 'gone')).toBeNull()
        expect(getFirstListItem).toHaveBeenCalledTimes(2)
    })

    it('falls back to a previous slug of the gym', async () => {
        expect(await findGym(pb, 'erste')).toMatchObject({
            id: 'g1',
            slug: 'first',
        })
    })

    it('skips the previous slug lookup for invalid slugs', async () => {
        expect(await findGym(pb, '%')).toBeNull()
        expect(getFirstListItem).toHaveBeenCalledTimes(1)
    })

    it('finds nothing for an empty slug without asking the server', async () => {
        expect(await findGym(pb, '')).toBeNull()
        expect(getFirstListItem).not.toHaveBeenCalled()
    })
})

describe('routeGymSlug', () => {
    it('reads the gym route param', () => {
        expect(routeGymSlug({ gym: 'first' })).toBe('first')
        expect(routeGymSlug({})).toBe('')
        expect(routeGymSlug({ gym: ['a'] })).toBe('')
    })
})

describe('routeParam', () => {
    it('reads a single string param of any typed route', () => {
        expect(routeParam({ token: 'abc' }, 'token')).toBe('abc')
        expect(routeParam({ id: ['a', 'b'] }, 'id')).toBe('')
        expect(routeParam({}, 'id')).toBe('')
    })
})
