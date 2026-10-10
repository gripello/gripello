import { beforeEach, describe, expect, it } from 'vitest'
import {
    createSeason,
    createTick,
    deleteSeason,
    deleteTick,
    getLeaderboard,
    listClimberTicks,
    listFeed,
    listOwnTicks,
    listSeasons,
    listSentRoutes,
    updateSeason,
    updateTick,
} from '~/api/ticks'
import { ApiError } from '~/api/client'
import { ROLLING_SEASON } from '~/utils/leaderboard'
import { isAlreadyApplied } from '~/utils/tickOutbox'
import type { TickRecord } from '~/types/models'
import { jsonResponse, mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

function call(index = -1) {
    const { url, method, body } = api.request(index)
    return { url: decodeURIComponent(url), method, body }
}

const tick: TickRecord = {
    id: 'abcdefghijklmno',
    user: 'u1',
    route: 'r1',
    type: 'top',
    attempts: 2,
    date: '2026-05-01',
    note: '',
    grade: '6a',
    created: '2026-05-01',
}

describe('own ticks', () => {
    it('reads the whole logbook page by page', async () => {
        const full = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}` }))
        api.respond({ items: full, page: 1, limit: 1000 })
        api.respond({ items: [{ id: 'last' }], page: 2, limit: 1000 })
        const list = await listOwnTicks({
            sort: '-date,-created',
            include: ['route.gym'],
        })
        expect(list.items).toHaveLength(1001)
        expect(call(0).url).toBe(
            '/api/me/ticks?sort=-date,-created&page=1&limit=1000',
        )
        expect(call(1).url).toBe(
            '/api/me/ticks?sort=-date,-created&page=2&limit=1000',
        )
    })

    it('filters by route and date and pages with totals', async () => {
        api.respond({ items: [], page: 2, limit: 10, total: 0 })
        await listOwnTicks({
            route: 'r1',
            since: new Date('2026-01-01T00:00:00Z'),
            page: 2,
            limit: 10,
            total: true,
        })
        expect(call().url).toBe(
            '/api/me/ticks?route=r1&page=2&limit=10&since=2026-01-01T00:00:00.000Z&total=true',
        )
    })

    it('lists the ids of sent routes', async () => {
        api.respond(['r1', 'r2'])
        expect(await listSentRoutes()).toEqual(['r1', 'r2'])
        expect(call().url).toBe('/api/me/ticks/sends')
    })

    it('creates a tick with its client id and only editable fields', async () => {
        api.respond(tick, 201)
        await createTick(tick)
        expect(call()).toMatchObject({
            url: '/api/me/ticks',
            method: 'POST',
            body: {
                id: tick.id,
                user: 'u1',
                route: 'r1',
                type: 'top',
                attempts: 2,
                date: '2026-05-01',
                note: '',
            },
        })
        expect(call().body).not.toHaveProperty('grade')
    })

    it('patches only type, attempts, date and note, and deletes', async () => {
        await updateTick(tick.id, { ...tick, attempts: 3 })
        expect(call()).toMatchObject({
            url: `/api/ticks/${tick.id}`,
            method: 'PATCH',
        })
        expect(call().body).toEqual({
            type: 'top',
            attempts: 3,
            date: '2026-05-01',
            note: '',
        })
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await deleteTick(tick.id)
        expect(call()).toMatchObject({
            url: `/api/ticks/${tick.id}`,
            method: 'DELETE',
        })
    })

    it('treats a duplicate client id as already applied', async () => {
        api.fetchMock.mockResolvedValueOnce(
            jsonResponse(
                {
                    status: 400,
                    message: 'Failed to create record.',
                    data: {
                        id: {
                            code: 'validation_pk_invalid',
                            message: 'taken',
                        },
                    },
                },
                400,
            ),
        )
        const error = await createTick(tick).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(ApiError)
        expect(
            isAlreadyApplied({ op: 'create', id: tick.id, queued: '' }, error),
        ).toBe(true)
    })
})

describe('feed', () => {
    it('pages the friends feed by date with totals', async () => {
        api.respond({ items: [{ id: 'f1' }], page: 1, limit: 60, total: 1 })
        const page = await listFeed({ page: 1, limit: 60, total: true })
        expect(page.total).toBe(1)
        expect(call().url).toBe(
            '/api/me/feed?page=1&limit=60&sort=-date&total=true',
        )
    })

    it('narrows the feed to a gym by creation', async () => {
        api.respond({ items: [], page: 1, limit: 100 })
        await listFeed({ gym: 'g1', sort: '-created', page: 1, limit: 100 })
        expect(call().url).toBe(
            '/api/me/feed?gym=g1&sort=-created&page=1&limit=100',
        )
    })
})

describe('listClimberTicks', () => {
    it("reads every page of a climber's ticks", async () => {
        api.respond({ items: [{ id: 't1' }], page: 1, limit: 1000 })
        expect(await listClimberTicks('u2')).toEqual([{ id: 't1' }])
        expect(call().url).toBe('/api/climbers/u2/ticks?page=1&limit=1000')
    })
})

describe('leaderboard and seasons', () => {
    it('loads a season board of a kind', async () => {
        await getLeaderboard('g1', { kind: 'route', season: 's1' })
        expect(call().url).toBe('/api/gyms/g1/leaderboard?kind=route&season=s1')
        await getLeaderboard('g1', { kind: 'boulder', season: ROLLING_SEASON })
        expect(call().url).toBe('/api/gyms/g1/leaderboard?kind=boulder')
    })

    it('lists seasons of a gym', async () => {
        api.respond([{ id: 's1' }])
        expect(await listSeasons('g1')).toEqual([{ id: 's1' }])
        expect(call().url).toBe('/api/gyms/g1/seasons')
    })

    it('creates, updates and deletes a season', async () => {
        const input = {
            name: 'Autumn',
            starts_at: '2026-09-01',
            ends_at: '2026-11-30',
        }
        await createSeason('g1', input)
        expect(call()).toMatchObject({
            url: '/api/gyms/g1/seasons',
            method: 'POST',
            body: input,
        })
        await updateSeason('s1', { name: 'Fall' })
        expect(call()).toMatchObject({
            url: '/api/seasons/s1',
            method: 'PATCH',
            body: { name: 'Fall' },
        })
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await deleteSeason('s1')
        expect(call()).toMatchObject({
            url: '/api/seasons/s1',
            method: 'DELETE',
        })
    })
})
