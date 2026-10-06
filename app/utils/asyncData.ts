import type { NuxtApp } from '#app'

// Join a running SSR fetch instead of cancelling it; in the browser later refreshes still win over a running fetch.
export const serverDedupe = {
    dedupe: (import.meta.server ? 'defer' : 'cancel') as 'defer' | 'cancel',
}

// For keys that are the same for every visitor: a component mounting later reuses loaded data.
export const sharedAsyncData = {
    ...serverDedupe,
    getCachedData: (
        key: string,
        nuxtApp: NuxtApp,
        context: { cause: string },
    ) => (context.cause === 'initial' ? nuxtApp.payload.data[key] : undefined),
}
