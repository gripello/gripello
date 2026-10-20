import { ApiError } from '~/api/client'

export function isAbortError(error: unknown): boolean {
    return !!(error as { isAbort?: boolean } | null)?.isAbort
}

export function endedSession(error: unknown) {
    return error instanceof ApiError && error.sessionEnded
}

export function isRateLimited(error: unknown): boolean {
    return (error as { status?: number } | null)?.status === 429
}

export function requestErrorKey(error: unknown, fallback: string) {
    return isRateLimited(error) ? 'errors.rateLimited' : fallback
}

export function isNetworkError(error: unknown): boolean {
    return (error as { status?: number } | null)?.status === 0
}

export function isAbortOrNetworkError(error: unknown): boolean {
    return isAbortError(error) || isNetworkError(error)
}

export function isRetryableSaveError(error: unknown): boolean {
    const status = (error as { status?: number } | null)?.status ?? 0
    return isAbortOrNetworkError(error) || status === 429 || status >= 500
}

export function isOfflineError(error: unknown) {
    const { status, isAbort } =
        (error as { status?: number; isAbort?: boolean } | null) ?? {}
    if (isAbort) return false
    return (
        // Node has a navigator without onLine, which must not make every SSR error look offline
        (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        status === 0
    )
}

type AsyncDataStore = {
    _asyncData: Record<
        string,
        { data: { value: unknown }; error: { value: unknown } } | undefined
    >
    payload: { data: Record<string, unknown> }
}

export async function keepWhenOffline<T>(
    nuxtApp: AsyncDataStore,
    key: string,
    fetch: () => Promise<T>,
    fits: (loaded: T) => boolean = () => true,
): Promise<T> {
    try {
        return await fetch()
    } catch (error) {
        const entry = nuxtApp._asyncData[key]
        // data holds the `default` until a fetch succeeds; only the payload tells loaded data apart
        const loaded =
            entry &&
            !entry.error.value &&
            nuxtApp.payload.data[key] !== undefined
                ? (entry.data.value as T)
                : null
        if (loaded == null || !isOfflineError(error) || !fits(loaded))
            throw error
        return loaded
    }
}
