import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    finishRender,
    isSsrCacheable,
    isSsrCachedPath,
    joinRender,
    readSsrCache,
    ssrCache,
    ssrCacheKey,
    ssrCacheTtlMs,
    withCacheAge,
    writeSsrCache,
} from '../../server/utils/ssrCache'
import { viewportBucket } from '../../shared/utils/breakpoints'

describe('ssr cache', () => {
    beforeEach(() => ssrCache.clear())

    it('is off unless SSR_CACHE_SECONDS is set', () => {
        expect(ssrCacheTtlMs({})).toBe(0)
        expect(ssrCacheTtlMs({ SSR_CACHE_SECONDS: '5' })).toBe(5000)
        expect(ssrCacheTtlMs({ SSR_CACHE_SECONDS: '-1' })).toBe(0)
    })

    it('only caches guest GETs of the public pages', () => {
        const base = {
            method: 'GET',
            pathname: '/gym-a/routes',
            hasAuthCookie: false,
            ttlMs: 5000,
        }
        expect(isSsrCacheable(base)).toBe(true)
        expect(isSsrCacheable({ ...base, hasAuthCookie: true })).toBe(false)
        expect(isSsrCacheable({ ...base, pathname: '/logbook' })).toBe(false)
        expect(isSsrCacheable({ ...base, pathname: '/routes' })).toBe(false)
        expect(isSsrCacheable({ ...base, method: 'POST' })).toBe(false)
        expect(isSsrCacheable({ ...base, ttlMs: 0 })).toBe(false)
    })

    it('caches the landing page and the public gym pages only', () => {
        for (const path of [
            '/',
            '/gym-a',
            '/gym-a/routes',
            '/gym-a/map',
            '/gym-a/route',
        ])
            expect(isSsrCachedPath(path), path).toBe(true)
        for (const path of [
            '/logbook',
            '/scan',
            '/privacy',
            '/route',
            '/gym-a/manage/routes',
            '/gym-a/logbook',
            '/gym-a/',
            '/ab',
            '/Gym-A',
        ])
            expect(isSsrCachedPath(path), path).toBe(false)
    })

    it('keys by language, viewport class, sidebar state, gym cookie, path and query', () => {
        const phone = ssrCacheKey({
            pathname: '/route',
            search: '?id=a',
            acceptLanguage: 'de-DE,de;q=0.9',
        })
        expect(phone).toBe('de|v0|o||/route?id=a')
        expect(
            ssrCacheKey({ pathname: '/', search: '', viewportWidth: '1400' }),
        ).toBe('|v4|o||/')
        expect(
            ssrCacheKey({
                pathname: '/',
                search: '',
                viewportWidth: '1400',
                sidebarOpen: 'false',
            }),
        ).toBe('|v4|c||/')
        expect(ssrCacheKey({ pathname: '/', search: '', gym: 'gym-a' })).toBe(
            '|v0|o|gym-a|/',
        )
    })

    it('buckets widths on the tailwind breakpoints', () => {
        expect([0, 639, 640, 767, 768, 1024, 1280].map(viewportBucket)).toEqual(
            [0, 0, 1, 1, 2, 3, 4],
        )
    })

    it('stamps the cache age on the html element', () => {
        expect(withCacheAge('<!DOCTYPE html><html lang="en">', 1234.4)).toBe(
            '<!DOCTYPE html><html data-ssr-age="1234" lang="en">',
        )
    })

    it('expires entries and evicts the least recently used', () => {
        writeSsrCache('k', '<html>', 1000)
        expect(readSsrCache('k', Date.now())?.body).toBe('<html>')
        expect(readSsrCache('k', Date.now() + 1001)).toBeNull()

        writeSsrCache('hot', 'hot', 60_000)
        for (let i = 0; i < 499; i++) writeSsrCache(`k${i}`, '', 60_000)
        readSsrCache('hot')
        writeSsrCache('overflow', '', 60_000)
        expect(ssrCache.size).toBe(500)
        expect(ssrCache.has('hot')).toBe(true)
        expect(ssrCache.has('k0')).toBe(false)
    })

    it('lets concurrent misses wait for one render', async () => {
        expect(joinRender('a').leader).toBe(true)
        const follower = joinRender('a')
        expect(follower.leader).toBe(false)
        finishRender('a', '<html>')
        await expect(follower.leader ? null : follower.result).resolves.toBe(
            '<html>',
        )
        expect(joinRender('a').leader).toBe(true)
        finishRender('a', null)
    })

    it('releases followers when the leader fails or hangs', async () => {
        vi.useFakeTimers()
        joinRender('b')
        const follower = joinRender('b')
        vi.advanceTimersByTime(10_000)
        await expect(follower.leader ? null : follower.result).resolves.toBe(
            null,
        )
        vi.useRealTimers()
    })
})
