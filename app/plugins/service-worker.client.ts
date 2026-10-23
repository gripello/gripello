import { createUpdateWatcher } from '~/utils/appUpdate'
import { offlineTabPaths } from '~/utils/navigation'
import { isInstalledApp } from '~/utils/native'

export default defineNuxtPlugin((nuxtApp) => {
    if (import.meta.dev) return
    const { buildId, buildAssetsDir } = useRuntimeConfig().app
    if ('serviceWorker' in navigator)
        navigator.serviceWorker
            .register(`/sw.js?build=${encodeURIComponent(buildId)}`)
            .then(() => {
                const saveData = (
                    navigator as Navigator & {
                        connection?: { saveData?: boolean }
                    }
                ).connection?.saveData
                if (!isInstalledApp() || saveData) return
                // Loads the main tabs' chunks through the worker so the installed app opens them offline.
                onNuxtReady(() =>
                    nuxtApp.runWithContext(() =>
                        offlineTabPaths(useGymCookie().value ?? '').forEach(
                            (path) => void preloadRouteComponents(path),
                        ),
                    ),
                )
            })
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
