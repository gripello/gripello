type AsyncDataStore = {
    _asyncData: Record<
        string,
        { data: { value: unknown }; error: { value: unknown } } | undefined
    >
    payload: { data: Record<string, unknown> }
}

// useAsyncData resets data to its default on a failed refresh; this keeps what the page shows.
export function keepShownOnError<T>(
    key: string,
    fetch: () => Promise<T>,
): (nuxtApp: AsyncDataStore) => Promise<T> {
    return async (nuxtApp) => {
        try {
            return await fetch()
        } catch (error) {
            const entry = nuxtApp._asyncData[key]
            if (
                entry &&
                !entry.error.value &&
                nuxtApp.payload.data[key] != null
            )
                return entry.data.value as T
            throw error
        }
    }
}
