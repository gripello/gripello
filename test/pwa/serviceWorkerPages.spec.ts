import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('public/sw.js', 'utf8')

function loadWorker(
    cacheControl: string | null,
    storedPages: string[] = [],
    previousBuildPages: string[] = [],
    cached?: Response,
    fetchDelayMs = 0,
) {
    const handlers: Record<string, (event: any) => void> = {}
    const put = vi.fn().mockResolvedValue(undefined)
    const caches = {
        open: vi.fn(async (name: string) => ({
            put,
            match: vi.fn().mockResolvedValue(cached),
            keys: vi
                .fn()
                .mockResolvedValue(
                    (name === 'gripello-0-pages'
                        ? previousBuildPages
                        : storedPages
                    ).map((url) => new Request(url)),
                ),
        })),
        keys: vi
            .fn()
            .mockResolvedValue([
                'gripello-0',
                'gripello-0-pages',
                'gripello-1',
                'gripello-1-pages',
            ]),
        match: vi.fn().mockResolvedValue(undefined),
    }
    const fetch = vi.fn(async () => {
        if (fetchDelayMs)
            await new Promise((resolve) => setTimeout(resolve, fetchDelayMs))
        if (cacheControl === null) throw new TypeError('Failed to fetch')
        return new Response('<html></html>', {
            headers: { 'cache-control': cacheControl },
        })
    })
    runInNewContext(source, {
        self: {
            location: new URL('https://gripello.app/sw.js?build=1'),
            addEventListener: (type: string, handler: any) => {
                handlers[type] = handler
            },
        },
        URL,
        Request,
        Response,
        caches,
        fetch,
        setTimeout,
        clearTimeout,
    })
    return { handlers, caches, put }
}

async function navigate(
    cacheControl: string | null,
    path: string,
    storedPages: string[] = [],
    previousBuildPages: string[] = [],
    {
        mode = 'navigate',
        cached,
        fetchDelayMs,
    }: { mode?: string; cached?: Response; fetchDelayMs?: number } = {},
) {
    const worker = loadWorker(
        cacheControl,
        storedPages,
        previousBuildPages,
        cached,
        fetchDelayMs,
    )
    let response: Promise<Response> | undefined
    worker.handlers.fetch!({
        request: {
            method: 'GET',
            mode,
            url: `https://gripello.app${path}`,
        },
        respondWith: (value: Promise<Response>) => (response = value),
    })
    const settled = await response
    await new Promise((resolve) => setTimeout(resolve))
    return { ...worker, response: settled }
}

describe('service worker page cache', () => {
    it('keeps signed-in gym pages and the logbook for offline cold starts', async () => {
        for (const path of ['/', '/e2e', '/e2e/routes', '/logbook']) {
            const { put } = await navigate('private, no-store', path)
            expect(put, path).toHaveBeenCalledWith(
                expect.objectContaining({ url: `https://gripello.app${path}` }),
                expect.any(Response),
            )
        }
    })

    it('never keeps staff or account pages', async () => {
        for (const path of ['/e2e/manage/routes', '/e2e/admin', '/account']) {
            const { put } = await navigate('private, no-store', path)
            expect(put, path).not.toHaveBeenCalled()
        }
    })

    it('never keeps the TV screen, which reloads only when online', async () => {
        const { put } = await navigate('public, max-age=0', '/e2e/tv')
        expect(put).not.toHaveBeenCalled()
    })

    it('sends an offline QR link to the stored page of its gym', async () => {
        const { response } = await navigate(null, '/route?id=abc', [
            'https://gripello.app/e2e/route?id=other',
            'https://gripello.app/e2e/route?id=abc',
        ])
        expect(response?.status).toBe(302)
        expect(response?.headers.get('location')).toBe(
            'https://gripello.app/e2e/route?id=abc',
        )
    })

    it('finds the stored gym page in the previous build too', async () => {
        const { response } = await navigate(
            null,
            '/route?id=abc',
            [],
            ['https://gripello.app/e2e/route?id=abc'],
        )
        expect(response?.status).toBe(302)
        expect(response?.headers.get('location')).toBe(
            'https://gripello.app/e2e/route?id=abc',
        )
    })

    it('shows the offline page for a QR link that was never opened', async () => {
        const { response } = await navigate(null, '/route?id=abc', [
            'https://gripello.app/e2e/route?id=other',
        ])
        expect(response?.status).toBe(503)
    })
})

describe('service worker route data', () => {
    const routePaths = [
        '/api/gyms/e2e/routes?page=1&sort=-created',
        '/api/gyms/e2e',
        '/api/routes/abc123def456ghi',
        '/api/routes?ids=a,b',
    ]

    it('keeps the gym, route lists and routes in the cache sign-out clears', async () => {
        for (const path of routePaths) {
            const { put, caches } = await navigate('', path, [], [], {
                mode: 'cors',
            })
            expect(put, path).toHaveBeenCalled()
            expect(caches.open, path).toHaveBeenCalledWith('gripello-1-pages')
        }
    })

    it('answers offline with the stored copy', async () => {
        const stored = new Response('{"items":[]}')
        const { response } = await navigate(null, routePaths[0]!, [], [], {
            mode: 'cors',
            cached: stored,
        })
        expect(response).toBe(stored)
    })

    it('fails like the network when nothing is stored, so loaded data stays', async () => {
        const { response } = await navigate(null, routePaths[0]!, [], [], {
            mode: 'cors',
        })
        expect(response?.type).toBe('error')
    })

    it('fails a missed wall list like the network too', async () => {
        const { response } = await navigate(
            null,
            '/api/gyms/e2e/walls?location=abc',
            [],
            [],
            { mode: 'cors' },
        )
        expect(response?.type).toBe('error')
    })

    it('waits for a slow network instead of answering with a stale route list', async () => {
        vi.useFakeTimers()
        const stored = new Response('{"items":[]}')
        const routes = navigate('', routePaths[0]!, [], [], {
            mode: 'cors',
            cached: stored,
            fetchDelayMs: 5000,
        })
        const walls = navigate('', '/api/gyms/e2e/walls', [], [], {
            mode: 'cors',
            cached: stored,
            fetchDelayMs: 5000,
        })
        await vi.advanceTimersByTimeAsync(6000)
        vi.useRealTimers()

        expect((await routes).response).not.toBe(stored)
        expect((await walls).response).toBe(stored)
    })

    it('does not keep searches, which would add an entry per query', async () => {
        const { put } = await navigate(
            '',
            '/api/gyms/e2e/routes?q=crimp&page=1',
            [],
            [],
            { mode: 'cors' },
        )
        expect(put).not.toHaveBeenCalled()
    })

    it('leaves staff route endpoints to the network', async () => {
        const { put } = await navigate(
            '',
            '/api/gyms/e2e/routes/reset-stats',
            [],
            [],
            { mode: 'cors' },
        )
        expect(put).not.toHaveBeenCalled()
    })
})
