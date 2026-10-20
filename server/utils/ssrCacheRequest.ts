import type { H3Event } from 'h3'
import { getCookie, getHeader, getRequestURL } from 'h3'
import { AUTH_COOKIE } from '#shared/utils/authCookie'
import { GYM_COOKIE, SIDEBAR_OPEN_COOKIE } from '#shared/utils/cookies'
import { isSsrCacheable, ssrCacheKey, ssrCacheTtlMs } from './ssrCache'

export const hasAuthCookie = (event: H3Event) => !!getCookie(event, AUTH_COOKIE)

export function ssrCacheRequest(event: H3Event) {
    const ttlMs = ssrCacheTtlMs()
    const url = getRequestURL(event)
    const cacheable = isSsrCacheable({
        method: event.method,
        pathname: url.pathname,
        hasAuthCookie: hasAuthCookie(event),
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
            sidebarOpen: getCookie(event, SIDEBAR_OPEN_COOKIE),
            gym: getCookie(event, GYM_COOKIE),
        }),
    }
}
