// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
    createApp,
    defineEventHandler,
    eventHandler,
    getCookie,
    getRequestURL,
    sendRedirect,
    toNodeListener,
} from 'h3'
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { GYM_COOKIE } from '#shared/utils/cookies'

const soleActiveGymSlug = vi.hoisted(() => vi.fn())
vi.mock('../../server/utils/legacyGymPaths', () => ({ soleActiveGymSlug }))

let server: Server
let base = ''

beforeAll(async () => {
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    vi.stubGlobal('getRequestURL', getRequestURL)
    vi.stubGlobal('getCookie', getCookie)
    vi.stubGlobal('sendRedirect', sendRedirect)
    const middleware = (
        await import('../../server/middleware/legacy-gym-paths')
    ).default
    const app = createApp()
        .use(middleware)
        .use(eventHandler(() => 'page'))
    server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
    server.close()
    vi.unstubAllGlobals()
})

beforeEach(() => soleActiveGymSlug.mockReset().mockResolvedValue(''))

const get = (path: string, gymCookie?: string) =>
    fetch(`${base}${path}`, {
        redirect: 'manual',
        headers: gymCookie ? { cookie: `${GYM_COOKIE}=${gymCookie}` } : {},
    })

describe('legacy gym paths middleware', () => {
    it('leaves current paths alone without looking up gyms', async () => {
        const res = await get('/gym-a/routes', 'gym-a')
        expect(res.status).toBe(200)
        expect(soleActiveGymSlug).not.toHaveBeenCalled()
    })

    it('redirects into the gym from the cookie, keeping the query', async () => {
        const res = await get('/routes?grade=6a', 'gym-a')
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe('/gym-a/routes?grade=6a')
        expect(soleActiveGymSlug).not.toHaveBeenCalled()
    })

    it('falls back to the only active gym when the cookie is missing or invalid', async () => {
        soleActiveGymSlug.mockResolvedValue('only-gym')
        expect((await get('/admin/reports')).headers.get('location')).toBe(
            '/only-gym/manage/moderation',
        )
        expect((await get('/map', '../evil')).headers.get('location')).toBe(
            '/only-gym/map',
        )
    })

    it('sends visitors to the start page when no gym can be picked', async () => {
        expect((await get('/manage')).headers.get('location')).toBe('/')
    })
})
