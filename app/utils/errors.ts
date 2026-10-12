import { isOfflineError } from '~/utils/tickOutbox'

export function isAbortError(error: unknown): boolean {
    return !!(error as { isAbort?: boolean } | null)?.isAbort
}

export function isNetworkError(error: unknown): boolean {
    return (error as { status?: number } | null)?.status === 0
}

type AsyncDataStore = {
    _asyncData: Record<string, { data: { value: unknown } } | undefined>
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
        const loaded = nuxtApp._asyncData[key]?.data.value as T | null
        if (loaded == null || !isOfflineError(error) || !fits(loaded))
            throw error
        return loaded
    }
}
