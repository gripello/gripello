import { toValue } from 'vue'
import type { AsyncDataOptions, NuxtApp } from '#app'
import { keepWhenOffline } from '~/utils/errors'

type OfflineDataOptions<T, D> = AsyncDataOptions<T, T, never, D> & {
    fits?: (loaded: T) => boolean
}

export function useOfflineData<T, D = undefined>(
    key: string | (() => string),
    fetch: (nuxtApp: NuxtApp, ctx: { signal: AbortSignal }) => Promise<T>,
    { fits, ...options }: OfflineDataOptions<T, D> = {},
) {
    return useAsyncData(
        key,
        (nuxtApp, ctx) =>
            keepWhenOffline(
                nuxtApp,
                toValue(key),
                () => fetch(nuxtApp, ctx),
                fits,
            ),
        options,
    )
}
