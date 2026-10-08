import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('public/sw.js', 'utf8')

function loadWorker(cacheControl: string) {
    const handlers: Record<string, (event: any) => void> = {}
    const put = vi.fn().mockResolvedValue(undefined)
    const caches = {
        open: vi.fn().mockResolvedValue({ put }),
        match: vi.fn().mockResolvedValue(undefined),
    }
    const fetch = vi.fn(
        async () =>
            new Response('<html></html>', {
                headers: { 'cache-control': cacheControl },
            }),
    )
    runInNewContext(source, {
        self: {
            location: new URL('https://gripello.app/sw.js?build=1'),
            addEventListener: (type: string, handler: any) => {
                handlers[type] = handler
            },
        },
        URL,
        Response,
        caches,
        fetch,
        setTimeout,
        clearTimeout,
    })
    return { handlers, caches, put }
}

async function navigate(cacheControl: string, path: string) {
    const worker = loadWorker(cacheControl)
    let response: Promise<Response> | undefined
    worker.handlers.fetch!({
        request: {
            method: 'GET',
            mode: 'navigate',
            url: `https://gripello.app${path}`,
        },
        respondWith: (value: Promise<Response>) => (response = value),
    })
    await response
    await new Promise((resolve) => setTimeout(resolve))
    return worker
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
})
