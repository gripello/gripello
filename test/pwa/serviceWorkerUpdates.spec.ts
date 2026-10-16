import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('public/sw.js', 'utf8')

function loadWorker(
    stored: Record<string, Record<string, Response>>,
    fetch: () => Promise<Response>,
) {
    const handlers: Record<string, (event: any) => void> = {}
    const match = async (cache: Record<string, Response>, request: any) =>
        cache[typeof request === 'string' ? request : request.url]?.clone()
    const caches = {
        keys: vi.fn(async () => Object.keys(stored)),
        delete: vi.fn(async (key: string) => delete stored[key]),
        open: vi.fn(async (key: string) => {
            const cache = (stored[key] ??= {})
            return {
                match: (request: any) => match(cache, request),
                put: async () => {},
            }
        }),
        match: vi.fn(async (request: any) => {
            for (const cache of Object.values(stored)) {
                const response = await match(cache, request)
                if (response) return response
            }
        }),
    }
    runInNewContext(source, {
        self: {
            location: new URL('https://gripello.app/sw.js?build=b3'),
            addEventListener: (type: string, handler: any) => {
                handlers[type] = handler
            },
            clients: { claim: async () => {} },
        },
        URL,
        Response,
        caches,
        fetch,
        setTimeout,
        clearTimeout,
    })
    return { handlers, stored }
}

async function dispatch(handler: (event: any) => void, data?: unknown) {
    let done: Promise<unknown> | undefined
    handler({ data, waitUntil: (value: Promise<unknown>) => (done = value) })
    await done
}

async function navigate(worker: ReturnType<typeof loadWorker>, url: string) {
    let response: Promise<Response> | undefined
    worker.handlers.fetch!({
        request: { method: 'GET', mode: 'navigate', url },
        respondWith: (value: Promise<Response>) => (response = value),
    })
    return response!
}

const page = 'https://gripello.app/e2e'

describe('service worker updates', () => {
    it('keeps the previous build for tabs still running it and drops older ones', async () => {
        const worker = loadWorker(
            {
                'gripello-b1': {},
                'gripello-b1-pages': {},
                'gripello-b2': {},
                'gripello-b2-pages': {},
                'gripello-b3': {},
            },
            vi.fn(),
        )
        await dispatch(worker.handlers.activate!)
        expect(Object.keys(worker.stored)).toEqual([
            'gripello-b2',
            'gripello-b2-pages',
            'gripello-b3',
        ])
    })

    it('clears the stored pages of every build on sign-out', async () => {
        const worker = loadWorker(
            {
                'gripello-b2': {},
                'gripello-b2-pages': {},
                'gripello-b3': {},
                'gripello-b3-pages': {},
            },
            vi.fn(),
        )
        await dispatch(worker.handlers.message!, { type: 'clear-pages' })
        expect(Object.keys(worker.stored)).toEqual([
            'gripello-b2',
            'gripello-b3',
        ])
    })

    it('shows the stored page instead of a server error, newest build first', async () => {
        const worker = loadWorker(
            {
                'gripello-b2-pages': { [page]: new Response('old') },
                'gripello-b3-pages': { [page]: new Response('stored') },
            },
            async () => new Response('Bad gateway', { status: 502 }),
        )
        expect(await (await navigate(worker, page)).text()).toBe('stored')
    })

    it('passes a server error through when nothing is stored', async () => {
        const worker = loadWorker(
            {},
            async () => new Response('Bad gateway', { status: 502 }),
        )
        expect((await navigate(worker, page)).status).toBe(502)
    })
})
