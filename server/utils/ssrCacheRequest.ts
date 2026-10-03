import type { H3Event } from 'h3'
import { getCookie, getHeader, getRequestURL } from 'h3'
import { isSsrCacheable, ssrCacheKey, ssrCacheTtlMs } from './ssrCache'

export function ssrCacheRequest(event: H3Event) {
    const ttlMs = ssrCacheTtlMs()
    const url = getRequestURL(event)
    const cacheable = isSsrCacheable({
        method: event.method,
        pathname: url.pathname,
        hasAuthCookie: !!getCookie(event, 'pb_auth'),
        ttlMs,
    })
    return {
        cacheable,
        ttlMs,
        key: ssrCacheKey({
            pathname: url.pathname,
            search: url.search,
            acceptLanguage: getHeader(event, 'accept-language'),
            viewportWidth: getHeader(event, 'sec-ch-viewport-width'),
            sidebarOpen: getCookie(event, 'sidebar-open'),
            gym: getCookie(event, 'gym'),
        }),
    }
}
