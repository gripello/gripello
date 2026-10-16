import { createUpdateWatcher } from '~/utils/appUpdate'

export default defineNuxtPlugin((nuxtApp) => {
    if (import.meta.dev) return
    const { buildId, buildAssetsDir } = useRuntimeConfig().app
    if ('serviceWorker' in navigator)
        navigator.serviceWorker
            .register(`/sw.js?build=${encodeURIComponent(buildId)}`)
            .catch((error) => {
                console.error('Service worker registration failed:', error)
            })

    // iOS keeps installed apps suspended for days and freezes Nuxt's hourly build check meanwhile.
    const watcher = createUpdateWatcher({
        buildId,
        latestBuildId: () =>
            $fetch<{ id?: string }>(
                `${buildAssetsDir}builds/latest.json?${Date.now()}`,
            ).then((latest) => latest.id),
        reload: () => reloadNuxtApp({ persistState: true }),
    })
    nuxtApp.hook('app:manifest:update', () => watcher.updateAvailable())
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void watcher.visible()
    })
})
