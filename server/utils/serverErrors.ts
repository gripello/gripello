import type { H3Event } from 'h3'
import { apiFetch } from './api-server'

export interface ServerErrorReport {
    kind: 'ssr'
    message: string
    stack: string
    route: string
    version: string
}

interface ErrorLike {
    name?: string
    message?: string
    stack?: string
    statusCode?: number
    cause?: unknown
}

// ofetch's message for a failed call: "[GET] "http://…/api/gyms/x": 500 …"; Go has logged those already.
const API_CALL_FAILURE = /^\[[A-Z]+\] "/

export function serverErrorReport(
    error: unknown,
    route: string,
    version: string,
): ServerErrorReport | null {
    const wrapper = (error ?? {}) as ErrorLike
    if ((wrapper.statusCode ?? 500) < 500) return null
    const original = (
        wrapper.cause instanceof Error ? wrapper.cause : wrapper
    ) as ErrorLike
    const message = original.message ?? ''
    if (
        !message ||
        original.name === 'FetchError' ||
        API_CALL_FAILURE.test(message)
    )
        return null
    return {
        kind: 'ssr',
        message: `${original.name ?? 'Error'}: ${message}`.slice(0, 500),
        stack: (original.stack ?? '').slice(0, 2000),
        route,
        version,
    }
}

export async function reportServerError(error: unknown, event?: H3Event) {
    const route = String(
        (event?.context.matchedRoute as { path?: string } | undefined)?.path ??
            '',
    )
    const version = String(useRuntimeConfig().public.appVersion ?? '')
    const report = serverErrorReport(error, route, version)
    if (!report) return
    await apiFetch(event)('/client-errors', {
        method: 'POST',
        body: report,
    }).catch(() => {})
}
