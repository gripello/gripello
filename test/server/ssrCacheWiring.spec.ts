// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
    createApp,
    defineEventHandler,
    eventHandler,
    setHeader,
    setResponseStatus,
    toNodeListener,
    type H3Event,
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
import { ssrCache } from '../../server/utils/ssrCache'
import { AUTH_COOKIE } from '#shared/utils/authCookie'

type RenderResponse = {
    body: unknown
    statusCode?: number
    headers?: Record<string, string>
}
type Hook = (...args: unknown[]) => void

const hooks: Record<string, Hook[]> = {}
let renders = 0
let status = 200
let gate: Promise<void> | null = null
let server: Server
let base = ''

async function render(event: H3Event) {
    renders++
    await gate
    const response: RenderResponse = {
        body: `<html><body>render ${renders}</body></html>`,
        statusCode: status,
        headers: {},
    }
    for (const hook of hooks['render:response'] ?? []) hook(response, { event })
    for (const [name, value] of Object.entries(response.headers ?? {}))
        setHeader(event, name, value)
    setResponseStatus(event, response.statusCode)
    return response.body
}

beforeAll(async () => {
    vi.stubEnv('SSR_CACHE_SECONDS', '5')
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    vi.stubGlobal('setHeader', setHeader)
    vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
    const middleware = (await import('../../server/middleware/ssr-cache'))
        .default
    const plugin = (await import('../../server/plugins/ssr-cache'))
        .default as unknown as (app: unknown) => void
    plugin({
        hooks: {
            hook: (name: string, fn: Hook) => (hooks[name] ??= []).push(fn),
        },
    })
    const app = createApp({
        onAfterResponse: (event) =>
            hooks.afterResponse?.forEach((fn) => fn(event)),
    })
    app.use(middleware).use(eventHandler(render))
    server = createServer(toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
    server.close()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

beforeEach(() => {
    ssrCache.clear()
    renders = 0
    status = 200
    gate = null
})

describe('ssr cache wiring', () => {
    it('serves a guest the cached render with its age', async () => {
        const first = await fetch(`${base}/gym-a`)
        expect(first.headers.get('x-ssr-cache')).toBeNull()
        expect(await first.text()).toContain('render 1')

        const second = await fetch(`${base}/gym-a`)
        expect(second.headers.get('x-ssr-cache')).toBe('hit')
        expect(await second.text()).toMatch(
            /^<html data-ssr-age="\d+"><body>render 1/,
        )
        expect(renders).toBe(1)
    })

    it('never caches or serves cached pages to a signed-in viewer', async () => {
        await fetch(`${base}/gym-a`)
        const signedIn = await fetch(`${base}/gym-a`, {
            headers: { cookie: `${AUTH_COOKIE}=token` },
        })
        expect(signedIn.headers.get('x-ssr-cache')).toBeNull()
        expect(signedIn.headers.get('cache-control')).toBe('private, no-store')
        expect(await signedIn.text()).toContain('render 2')

        ssrCache.clear()
        await fetch(`${base}/gym-b`, {
            headers: { cookie: `${AUTH_COOKIE}=token` },
        })
        expect(ssrCache.size).toBe(0)
    })

    it('does not cache error pages', async () => {
        status = 503
        await fetch(`${base}/gym-a`)
        status = 200
        expect(await (await fetch(`${base}/gym-a`)).text()).toContain(
            'render 2',
        )
    })

    it('keeps languages apart', async () => {
        await fetch(`${base}/gym-a`, { headers: { 'accept-language': 'de' } })
        const english = await fetch(`${base}/gym-a`, {
            headers: { 'accept-language': 'en' },
        })
        expect(english.headers.get('x-ssr-cache')).toBeNull()
        expect(renders).toBe(2)
    })

    it('renders concurrent misses once', async () => {
        let open!: () => void
        gate = new Promise((resolve) => (open = resolve))
        const pending = [fetch(`${base}/gym-a`), fetch(`${base}/gym-a`)]
        await vi.waitFor(() => expect(renders).toBe(1))
        open()
        const bodies = await Promise.all(
            (await Promise.all(pending)).map((r) => r.text()),
        )
        expect(renders).toBe(1)
        bodies.forEach((body) => expect(body).toContain('render 1'))
    })

    it('lets a waiting request render itself when the leader fails', async () => {
        let open!: () => void
        gate = new Promise((resolve) => (open = resolve))
        status = 500
        const leader = fetch(`${base}/gym-a`)
        await vi.waitFor(() => expect(renders).toBe(1))
        const follower = fetch(`${base}/gym-a`)
        await new Promise((resolve) => setTimeout(resolve, 20))
        open()
        await leader
        const response = await follower
        expect(response.headers.get('x-ssr-cache')).toBeNull()
        expect(renders).toBe(2)
    })
})
