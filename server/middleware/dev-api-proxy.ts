import { defineEventHandler, getRequestURL, proxyRequest } from 'h3'
import { isGoApiPath } from '#shared/utils/apiVersion'

export default defineEventHandler((event) => {
    if (!import.meta.dev) return
    const { pathname, search } = getRequestURL(event)
    if (!isGoApiPath(pathname)) return
    return proxyRequest(
        event,
        `${useRuntimeConfig().apiBase}${pathname}${search}`,
    )
})
