import { viewportBucket } from '../../shared/utils/breakpoints'
import { RESERVED_GYM_SLUGS } from '../../shared/utils/gymSlug'

const SSR_CACHED_PATH = /^\/(?:([a-z0-9-]{3,40})(?:\/(?:routes|map|route))?)?$/

export function isSsrCachedPath(pathname: string) {
    const match = SSR_CACHED_PATH.exec(pathname)
    return !!match && !RESERVED_GYM_SLUGS.includes(match[1] ?? '')
}
export const SSR_AGE_ATTRIBUTE = 'data-ssr-age'

export interface SsrCacheEntry {
    body: string
    created: number
    expires: number
}

export function ssrCacheTtlMs(env = process.env) {
    return Math.max(0, Number(env.SSR_CACHE_SECONDS || 0)) * 1000
}

export function isSsrCacheable(request: {
    method: string
    pathname: string
    hasAuthCookie: boolean
    ttlMs: number
}) {
    return (
        request.ttlMs > 0 &&
        request.method === 'GET' &&
        !request.hasAuthCookie &&
        isSsrCachedPath(request.pathname)
    )
}

export function ssrCacheKey(request: {
    pathname: string
    search: string
    acceptLanguage?: string
    viewportWidth?: string
    sidebarOpen?: string
    gym?: string
}) {
    const lang =
        (request.acceptLanguage || '').split(',')[0]?.trim().slice(0, 2) || ''
    const viewport = viewportBucket(Number(request.viewportWidth) || 0)
    const sidebar = request.sidebarOpen === 'false' ? 'c' : 'o'
    return `${lang}|v${viewport}|${sidebar}|${request.gym ?? ''}|${request.pathname}${request.search}`
}

export function withCacheAge(body: string, ageMs: number) {
    return body.replace(
        '<html',
        `<html ${SSR_AGE_ATTRIBUTE}="${Math.round(ageMs)}"`,
    )
}

// ponytail: one in-memory map per Node process, capped by entry count; move to a shared store if Nuxt ever runs more than one instance
const MAX_ENTRIES = 500
export const ssrCache = new Map<string, SsrCacheEntry>()

export function readSsrCache(key: string, now = Date.now()) {
    const entry = ssrCache.get(key)
    if (!entry) return null
    if (entry.expires <= now) {
        ssrCache.delete(key)
        return null
    }
    ssrCache.delete(key)
    ssrCache.set(key, entry)
    return entry
}

export function writeSsrCache(key: string, body: string, ttlMs: number) {
    const now = Date.now()
    ssrCache.delete(key)
    ssrCache.set(key, { body, created: now, expires: now + ttlMs })
    while (ssrCache.size > MAX_ENTRIES)
        ssrCache.delete(ssrCache.keys().next().value as string)
}

const RENDER_WAIT_MS = 10_000
const inflight = new Map<string, (body: string | null) => void>()
const inflightResults = new Map<string, Promise<string | null>>()

export function joinRender(key: string) {
    const pending = inflightResults.get(key)
    if (pending) return { leader: false as const, result: pending }
    const result = new Promise<string | null>((resolve) => {
        inflight.set(key, resolve)
        setTimeout(() => finishRender(key, null), RENDER_WAIT_MS)
    })
    inflightResults.set(key, result)
    return { leader: true as const }
}

export function finishRender(key: string, body: string | null) {
    const resolve = inflight.get(key)
    if (!resolve) return
    inflight.delete(key)
    inflightResults.delete(key)
    resolve(body)
}
