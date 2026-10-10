import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGym, routeGymSlug, routeParam } from '~/composables/useGym'
import { getGym } from '~/api/gyms'
import { routeApi } from '../api/apiMock'

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

const getGymRequest = vi.fn()

describe('loadGym', () => {
    beforeEach(() => {
        getGymRequest.mockReset().mockImplementation(async (path: string) => {
            const slug = decodeURIComponent(path.replace('/gyms/', ''))
            const gym = gyms.find(
                (g) =>
                    g.active &&
                    (g.slug === slug || g.previous_slugs?.includes(slug)),
            )
            if (!gym) throw Object.assign(new Error('missing'), { status: 404 })
            return gym.slug === slug ? gym : { ...gym, redirect_to: gym.slug }
        })
        routeApi(getGymRequest)
    })

    it('prefers the gym named in the route over the cookie', async () => {
        expect(await loadGym('second', 'first')).toMatchObject({ id: 'g2' })
    })

    it('rejects an unknown or inactive route slug with 404', async () => {
        await expect(loadGym('nope', '')).rejects.toMatchObject({
            statusCode: 404,
        })
        await expect(loadGym('closed', '')).rejects.toMatchObject({
            statusCode: 404,
        })
    })

    it('uses the cookie when the route has no gym', async () => {
        expect(await loadGym('', 'second')).toMatchObject({ id: 'g2' })
    })

    it('returns null without route slug and cookie or for a stale cookie', async () => {
        expect(await loadGym('', '')).toBeNull()
        expect(await loadGym('', 'gone')).toBeNull()
        expect(getGymRequest).toHaveBeenCalledTimes(1)
    })

    it('resolves a previous slug to the current gym without redirect_to', async () => {
        const gym = await getGym('erste')
        expect(gym).toMatchObject({ id: 'g1', slug: 'first' })
        expect(gym).not.toHaveProperty('redirect_to')
    })

    it('finds nothing for an empty slug without asking the server', async () => {
        expect(await getGym('')).toBeNull()
        expect(getGymRequest).not.toHaveBeenCalled()
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
