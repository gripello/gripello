import { isOfflineError } from '~/utils/tickOutbox'

export function isAbortError(error: unknown): boolean {
    return !!(error as { isAbort?: boolean } | null)?.isAbort
}

export function isNetworkError(error: unknown): boolean {
    return (error as { status?: number } | null)?.status === 0
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
