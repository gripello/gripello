import { beforeEach, describe, expect, it } from 'vitest'
import {
    archiveRoute,
    archiveRoutes,
    createLocation,
    createRoute,
    deleteLocation,
    deleteMapTrace,
    deleteRoute,
    getRoute,
    listLocations,
    listRouteColors,
    listRoutes,
    listWalls,
    listWallsByIds,
    placeRoutes,
    saveFloorPlan,
    updateRoute,
    uploadMapTrace,
} from '~/api/routes'
import { jsonResponse, mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

function query(index = -1) {
    return new URL(api.request(index).url, 'http://x').searchParams
}

describe('listRoutes', () => {
    it('reads every page of a gym when no page is asked for', async () => {
        const full = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` }))
        api.respond({ items: full, page: 1, limit: 1000 })
        api.respond({ items: [{ id: 'last' }], page: 2, limit: 1000 })
        const list = await listRoutes('g1')
        expect(api.request(0).url).toBe('/api/gyms/g1/routes?page=1&limit=1000')
        expect(api.request(1).url).toBe('/api/gyms/g1/routes?page=2&limit=1000')
        expect(list).toEqual({
            items: [...full, { id: 'last' }],
            page: 1,
            limit: 1001,
        })
    })

    it('sends every filter as a query param', async () => {
        api.respond({ items: [] })
        await listRoutes('g1', {
            archived: true,
            location: 'loc',
            wall: 'none',
            type: 'Boulder',
            color: '#fff',
            grade_system: 'font',
            grade: ['6a', '6a+'],
            q: 'Funk "x"',
            since: new Date('2026-01-01T00:00:00Z'),
            ids: ['r1', 'r2'],
            include: ['location', 'wall'],
            sort: '-created,name',
        })
        const params = query()
        expect(Object.fromEntries(params)).toMatchObject({
            archived: 'true',
            location: 'loc',
            wall: 'none',
            type: 'Boulder',
            color: '#fff',
            grade_system: 'font',
            q: 'Funk "x"',
            since: '2026-01-01T00:00:00.000Z',
            ids: 'r1,r2',
            include: 'location,wall',
            sort: '-created,name',
        })
        expect(params.getAll('grade')).toEqual(['6a', '6a+'])
    })

    it('fetches one page with the total on request', async () => {
        api.respond({ items: [{ id: 'a' }], page: 2, limit: 5, total: 7 })
        const list = await listRoutes('g1', {
            archived: 'all',
            page: 2,
            limit: 5,
            total: true,
        })
        expect(api.request().url).toBe(
            '/api/gyms/g1/routes?archived=all&page=2&limit=5&total=true',
        )
        expect(list).toEqual({
            items: [{ id: 'a' }],
            page: 2,
            limit: 5,
            total: 7,
        })
    })

    it('reads routes of any gym by id in chunks of 200', async () => {
        const ids = Array.from({ length: 201 }, (_, i) => `r${i}`)
        api.fetchMock.mockImplementation(async () =>
            jsonResponse({ items: [{ id: 'x' }] }),
        )
        const list = await listRoutes(null, { ids, include: ['gym'] })
        expect(api.fetchMock).toHaveBeenCalledTimes(2)
        expect(query(0).get('ids')!.split(',')).toHaveLength(200)
        expect(api.request(1).url).toBe('/api/routes?include=gym&ids=r200')
        expect(list.items).toHaveLength(2)
    })

    it('refuses a cross-gym list without ids', async () => {
        await expect(listRoutes(null, {})).rejects.toThrow()
    })

    it('answers empty id or grade lists without a request', async () => {
        expect((await listRoutes('g1', { ids: [] })).items).toEqual([])
        expect((await listRoutes('g1', { grade: [] })).items).toEqual([])
        expect(api.fetchMock).not.toHaveBeenCalled()
    })
})

describe('route records', () => {
    it('gets a route with included relations', async () => {
        await getRoute('r1', ['location', 'wall'])
        expect(api.request().url).toBe('/api/routes/r1?include=location,wall')
        await getRoute('r1')
        expect(api.request().url).toBe('/api/routes/r1')
    })

    it('creates, patches and deletes a route', async () => {
        await createRoute('g1', { name: 'Funk', grade: '6a' })
        expect(api.request()).toMatchObject({
            url: '/api/gyms/g1/routes',
            method: 'POST',
            body: { name: 'Funk', grade: '6a' },
        })
        await updateRoute('r1', { name: 'Soul' })
        expect(api.request()).toMatchObject({
            url: '/api/routes/r1',
            method: 'PATCH',
            body: { name: 'Soul' },
        })
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        expect(await deleteRoute('r1')).toBe(true)
        expect(api.request()).toMatchObject({
            url: '/api/routes/r1',
            method: 'DELETE',
        })
    })

    it('forces a route delete that takes its history along', async () => {
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await deleteRoute('r1', true)
        expect(api.request()).toMatchObject({
            url: '/api/routes/r1?force=true',
            method: 'DELETE',
        })
    })

    it('archives and restores a single route', async () => {
        await archiveRoute('r1', false)
        expect(api.request()).toMatchObject({
            url: '/api/routes/r1/archive',
            method: 'POST',
            body: { archived: false },
        })
    })

    it('archives many routes in one call', async () => {
        await archiveRoutes('g1', ['a', 'b'])
        expect(api.request()).toMatchObject({
            url: '/api/gyms/g1/routes/archive',
            method: 'POST',
            body: { ids: ['a', 'b'], archived: true },
        })
        await archiveRoutes('g1', [])
        expect(api.fetchMock).toHaveBeenCalledTimes(1)
    })

    it('places routes on walls in one call', async () => {
        const placements = [
            { route: 'a', wall: 'w1', wall_position: 0.5 },
            { route: 'b', wall: '' },
        ]
        await placeRoutes('g1', placements)
        expect(api.request()).toMatchObject({
            url: '/api/gyms/g1/map/placements',
            method: 'PUT',
            body: { placements },
        })
    })

    it('lists the distinct colours of a gym', async () => {
        api.respond({ items: ['#fff', ''] })
        expect(await listRouteColors('g1')).toEqual(['#fff'])
        expect(api.request().url).toBe('/api/gyms/g1/routes/colors')
    })
})

describe('locations', () => {
    it('lists locations of a gym', async () => {
        api.respond({ items: [{ id: 'l1' }] })
        expect(await listLocations('g1')).toEqual([{ id: 'l1' }])
        expect(api.request().url).toBe('/api/gyms/g1/locations')
    })

    it('creates and deletes a location', async () => {
        await createLocation('g1', { name: 'Hall' })
        expect(api.request()).toMatchObject({
            url: '/api/gyms/g1/locations',
            method: 'POST',
            body: { name: 'Hall' },
        })
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await deleteLocation('l1')
        expect(api.request()).toMatchObject({
            url: '/api/locations/l1',
            method: 'DELETE',
        })
    })

    it('fails with the field errors when a location is in use', async () => {
        api.respond(
            {
                status: 400,
                message: 'In use.',
                data: { id: { code: 'in_use', message: 'In use.' } },
            },
            400,
        )
        await expect(deleteLocation('l1')).rejects.toMatchObject({
            status: 400,
            response: { data: { id: { code: 'in_use' } } },
        })
    })

    it('uploads and removes the map trace', async () => {
        const file = new File(['x'], 'trace.png')
        await uploadMapTrace('l1', file)
        const upload = api.request()
        expect(upload).toMatchObject({
            url: '/api/locations/l1/map-trace',
            method: 'PUT',
        })
        expect((upload.body as FormData).get('map_trace')).toBeInstanceOf(Blob)
        await deleteMapTrace('l1')
        expect(api.request()).toMatchObject({
            url: '/api/locations/l1/map-trace',
            method: 'DELETE',
        })
    })

    it('saves the floor plan in one call', async () => {
        const saved = {
            location: { id: 'l1' },
            walls: [{ id: 'new' }, { id: 'w2' }],
        }
        api.respond(saved)
        const map = { width: 10, height: 10, shapes: [] }
        const walls = [{ name: 'New' }, { id: 'w2', name: 'Old' }]
        expect(
            await saveFloorPlan('l1', { map, walls, removed: ['w3'] }),
        ).toEqual(saved)
        expect(api.request()).toMatchObject({
            url: '/api/locations/l1/floor-plan',
            method: 'PUT',
            body: { map, walls, removed: ['w3'] },
        })
    })
})

describe('walls', () => {
    it('lists walls of a gym, optionally of one location', async () => {
        api.respond({ items: [{ id: 'w1' }] })
        expect(await listWalls('g1')).toEqual([{ id: 'w1' }])
        expect(api.request().url).toBe('/api/gyms/g1/walls')
        api.respond({ items: [] })
        await listWalls('g1', { location: 'l1' })
        expect(api.request().url).toBe('/api/gyms/g1/walls?location=l1')
    })

    it('lists followed walls by id with their location name', async () => {
        api.respond({ items: [{ id: 'w1', location_name: 'Hall' }] })
        expect(await listWallsByIds(['w1', 'w2'])).toEqual([
            { id: 'w1', location_name: 'Hall' },
        ])
        expect(api.request().url).toBe('/api/walls?ids=w1,w2')
        expect(await listWallsByIds([])).toEqual([])
        expect(api.fetchMock).toHaveBeenCalledTimes(1)
    })
})
