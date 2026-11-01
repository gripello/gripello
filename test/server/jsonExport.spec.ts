// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, toNodeListener } from 'h3'
import { ofetch } from 'ofetch'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import jsonExport from '../../server/api/ui/json'

const ROUTES = [
    {
        id: 'r1',
        name: 'Crimp',
        grade: '6a',
        anchor_point: '3',
        wall_position: 'x',
        archived: 0,
        creator: ['Ann'],
        expand: { location: { name: 'Hall' }, wall: { name: 'North' } },
    },
    { id: 'r2', name: 'Sloper', archived: 1 },
]
const RATINGS = [
    { id: 'a', route_id: 'r2', rating: '4', comment: 'nice' },
    { id: 'b', route_id: 'r1', rating: 5 },
    { id: 'c', route_id: '', rating: 1 },
]

let permissions: string[] = []
const goRequests: string[] = []
let goApi: Server
let nuxt: Server
let base = ''
let goBase = ''

async function listen(server: Server) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

beforeAll(async () => {
    goApi = createServer((req, res) => {
        const url = new URL(req.url!, 'http://go')
        goRequests.push(url.pathname)
        const json = (body: unknown) => {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(body))
        }
        if (url.pathname === '/api/me/memberships')
            return json([{ gym: { id: 'gymA' }, role: { permissions } }])
        if (url.pathname === '/api/gyms/gymA/routes') {
            const ids = url.searchParams.get('ids')!.split(',')
            return json({ items: ROUTES.filter((r) => ids.includes(r.id)) })
        }
        if (url.pathname === '/api/gyms/gymA/ratings')
            return json({ items: RATINGS })
        res.writeHead(404).end()
    })
    goBase = await listen(goApi)
    nuxt = createServer(toNodeListener(createApp().use(jsonExport)))
    base = await listen(nuxt)
})

afterAll(() => {
    goApi.close()
    nuxt.close()
})

beforeEach(() => {
    Object.assign(globalThis.$fetch, { create: ofetch.create })
    globalThis.__NUXT_RUNTIME_CONFIG__ = { apiBase: goBase, public: {} }
    permissions = ['manage_routes']
    goRequests.length = 0
})

const exportRoutes = (body: unknown, token: string | null = 'tok') =>
    fetch(base, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    })

describe('JSON route export', () => {
    it('requires a session and manage_routes in the requested gym', async () => {
        expect(
            (await exportRoutes({ gym: 'gymA', ids: ['r1'] }, null)).status,
        ).toBe(401)
        expect((await exportRoutes({ gym: 'gymB', ids: ['r1'] })).status).toBe(
            403,
        )
        permissions = ['manage_tasks']
        expect((await exportRoutes({ gym: 'gymA', ids: ['r1'] })).status).toBe(
            403,
        )
        expect(goRequests.every((path) => path === '/api/me/memberships')).toBe(
            true,
        )
    })

    it('refuses an export without routes', async () => {
        expect((await exportRoutes({ gym: 'gymA', ids: [] })).status).toBe(400)
        expect(
            (await exportRoutes({ gym: 'gymA', ids: ['', '  '] })).status,
        ).toBe(400)
    })

    it('exports the requested routes in order with their reviews', async () => {
        const res = await exportRoutes({
            gym: 'gymA',
            ids: ['r2', 'missing', 'r1', 'r2'],
        })
        expect(res.status).toBe(200)
        const [sloper, crimp, ...rest] = await res.json()
        expect(rest).toEqual([])

        expect(sloper).toMatchObject({
            id: 'r2',
            archived: true,
            anchor_point: null,
            creator: [],
            ratings: [{ rating: 4, comment: 'nice' }],
        })
        expect(crimp).toMatchObject({
            id: 'r1',
            archived: false,
            anchor_point: 3,
            wall_position: null,
            location: 'Hall',
            wall: 'North',
            creator: ['Ann'],
            ratings: [{ rating: 5, comment: '' }],
        })
    })
})
