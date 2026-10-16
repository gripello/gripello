import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const html = readFileSync('public/offline.html', 'utf8')
const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!

describe('offline page', () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('reloads by itself once the API reports healthy and the page loads', async () => {
        vi.useFakeTimers()
        document.body.innerHTML = /<body>([\s\S]*)<script>/.exec(html)![1]!
        const reload = vi.fn()
        const health = (status: string) =>
            new Response(JSON.stringify({ status }), { status: 200 })
        const fetch = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('offline'))
            .mockResolvedValueOnce(new Response('', { status: 502 }))
            .mockResolvedValueOnce(health('unavailable'))
            .mockResolvedValueOnce(new Response('<html>'))
            .mockResolvedValueOnce(health('ok'))
            .mockResolvedValueOnce(new Response('<html>'))
        vi.stubGlobal('fetch', fetch)
        vi.stubGlobal('location', { reload, href: 'https://gripello.app/e2e' })
        new Function(script)()

        await vi.advanceTimersByTimeAsync(10_000)
        await vi.advanceTimersByTimeAsync(10_000)
        expect(reload).not.toHaveBeenCalled()
        window.dispatchEvent(new Event('online'))
        await vi.advanceTimersByTimeAsync(0)
        expect(reload).toHaveBeenCalledOnce()
        expect(fetch).toHaveBeenCalledWith('/api/health', { cache: 'no-store' })
        expect(fetch).toHaveBeenCalledWith('https://gripello.app/e2e', {
            cache: 'no-store',
        })
    })
})
