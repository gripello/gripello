import type { ClientErrorReport } from '~/api/platform'

const MAX_REPORTS_PER_PAGE = 10

const IGNORED = [
    /ResizeObserver loop/,
    /^Script error\.?$/,
    /chrome-extension:|moz-extension:|safari-extension:/,
]

// The server logs API failures itself; aborts, network drops (Nuxt also treats a failed CSS preload as non-fatal) and Nuxt errors below 500 (unknown gym or route) are not bugs.
function isExpected(error: unknown) {
    if (!error || typeof error !== 'object') return false
    const { name, message, statusCode } = error as {
        name?: string
        message?: string
        statusCode?: number
    }
    return (
        name === 'ApiError' ||
        name === 'AbortError' ||
        (typeof statusCode === 'number' && statusCode < 500) ||
        /Failed to fetch|NetworkError|Load failed|Unable to preload CSS/.test(
            message ?? '',
        )
    )
}

export function errorMessage(error: unknown) {
    if (error instanceof Error) return `${error.name}: ${error.message}`
    return typeof error === 'string' ? error : (JSON.stringify(error) ?? '')
}

// The matched route pattern (`/:gym/routes`), never the path: that would carry ids and query values.
export function routePattern(matched: ReadonlyArray<{ path: string }>) {
    return matched.at(-1)?.path ?? ''
}

export function createReporter(send: (report: ClientErrorReport) => void) {
    const seen = new Set<string>()
    return (
        kind: ClientErrorReport['kind'],
        error: unknown,
        context: { route: string; version: string },
    ) => {
        if (isExpected(error)) return
        const message = errorMessage(error).slice(0, 500)
        const stack = error instanceof Error ? (error.stack ?? '') : ''
        if (
            !message ||
            IGNORED.some((rule) => rule.test(message) || rule.test(stack))
        )
            return
        if (seen.has(message) || seen.size >= MAX_REPORTS_PER_PAGE) return
        seen.add(message)
        send({ kind, message, stack: stack.slice(0, 2000), ...context })
    }
}
