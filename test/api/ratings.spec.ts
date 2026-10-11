import { beforeEach, describe, expect, it } from 'vitest'
import {
    createBeta,
    createRating,
    deleteBeta,
    deleteRating,
    getRatingStats,
    importRatings,
    listBetas,
    listContributions,
    listGymBetas,
    listGymRatings,
    listRouteRatings,
    updateRating,
} from '~/api/ratings'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

function call(index = -1) {
    const { url, method, body, headers } = api.request(index)
    return { url: decodeURIComponent(url), method, body, headers }
}

describe('listRouteRatings', () => {
    it('reads one page of a route large enough for every review', async () => {
        api.respond({ items: [{ id: 'a', mine: true }], page: 1, limit: 500 })
        const list = await listRouteRatings('r1')
        expect(call().url).toBe('/api/routes/r1/ratings?limit=500')
        expect(list.items).toEqual([{ id: 'a', mine: true }])
    })
})

describe('listGymRatings', () => {
    it('sends every filter as a query parameter', async () => {
        await listGymRatings('g1', {
            route: ['r1', 'r2'],
            location: 'loc',
            grade_system: 'font',
            grade: '6a',
            rating: 4,
            min_rating: 2,
            max_rating: 5,
            since: new Date('2026-01-01T00:00:00Z'),
            q: 'nice',
            ids: ['a', 'b'],
            include: ['route_id.location'],
            sort: 'lowest',
            page: 2,
            limit: 48,
            total: true,
        })
        const url = new URL(call().url, 'http://x')
        expect(url.pathname).toBe('/api/gyms/g1/ratings')
        expect(Object.fromEntries(url.searchParams)).toEqual({
            route: 'r1,r2',
            location: 'loc',
            grade_system: 'font',
            grade: '6a',
            rating: '4',
            min_rating: '2',
            max_rating: '5',
            since: '2026-01-01T00:00:00.000Z',
            q: 'nice',
            ids: 'a,b',
            sort: 'lowest',
            page: '2',
            limit: '48',
            total: 'true',
        })
    })

    it('answers empty id or route lists without a request', async () => {
        expect((await listGymRatings('g1', { ids: [] })).items).toEqual([])
        expect((await listGymRatings('g1', { route: [] })).items).toEqual([])
        expect(api.fetchMock).not.toHaveBeenCalled()
    })
})

describe('rating stats', () => {
    it('reads the stats of a gym', async () => {
        const stats = {
            total_reviews: 3,
            avg_rating: 4.2,
            low_rated: 1,
            this_week: 2,
        }
        api.respond(stats)
        expect(await getRatingStats('g1')).toEqual(stats)
        expect(call().url).toBe('/api/gyms/g1/ratings/stats')
    })
})

describe('rating records', () => {
    it('creates a rating without the client id, passing captcha headers', async () => {
        api.respond({ id: 'server' }, 201)
        const created = await createRating(
            'r1',
            { id: 'client', rating: 4, comment: 'x' },
            { 'X-Cap-Token': 't' },
        )
        expect(created).toEqual({ id: 'server' })
        expect(call()).toMatchObject({
            url: '/api/routes/r1/ratings',
            method: 'POST',
            body: { rating: 4, comment: 'x' },
        })
        expect(call().headers.get('X-Cap-Token')).toBe('t')
    })

    it('updates and deletes a rating', async () => {
        await updateRating('a', { rating: 2 })
        expect(call()).toMatchObject({
            url: '/api/ratings/a',
            method: 'PATCH',
            body: { rating: 2 },
        })
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await deleteRating('a')
        expect(call()).toMatchObject({
            url: '/api/ratings/a',
            method: 'DELETE',
        })
    })

    it('imports ratings into a gym', async () => {
        api.respond({ failed: 1 })
        const rows = [{ route_id: 'r1', rating: 5 }]
        expect(await importRatings('g1', rows)).toEqual({ failed: 1 })
        expect(call()).toMatchObject({
            url: '/api/gyms/g1/ratings/import',
            method: 'POST',
            body: { ratings: rows },
        })
    })

    it('loads the own contributions', async () => {
        api.respond({ reviews: [{ id: 'a' }], betas: [] })
        expect(await listContributions()).toEqual({
            reviews: [{ id: 'a' }],
            betas: [],
        })
        expect(call().url).toBe('/api/me/contributions')
    })
})

describe('betas', () => {
    it('lists the betas of a route', async () => {
        api.respond({ items: [{ id: 'b1' }] })
        expect(await listBetas('r1')).toEqual([{ id: 'b1' }])
        expect(call().url).toBe('/api/routes/r1/betas')
    })

    it('lists the newest betas of a gym with their routes', async () => {
        api.respond({ items: [], page: 1, limit: 20 })
        await listGymBetas('g1', { include: ['route'], page: 1, limit: 20 })
        expect(call().url).toBe(
            '/api/gyms/g1/betas?include=route&page=1&limit=20',
        )
    })

    it('posts a link as JSON and an upload as multipart', async () => {
        api.respond({ pending: true }, 202)
        expect(
            await createBeta('r1', { url: 'https://youtube.com/shorts/x' }),
        ).toEqual({ pending: true })
        expect(call()).toMatchObject({
            url: '/api/routes/r1/betas',
            method: 'POST',
            body: { url: 'https://youtube.com/shorts/x' },
        })
        const file = new File(['v'], 'beta.mp4', { type: 'video/mp4' })
        await createBeta('r1', { file })
        const form = call().body as FormData
        expect(form.get('file')).toBeInstanceOf(Blob)
    })

    it('deletes a beta', async () => {
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await deleteBeta('b1')
        expect(call()).toMatchObject({
            url: '/api/betas/b1',
            method: 'DELETE',
        })
    })
})
