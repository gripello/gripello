const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000

export function createUpdateWatcher(options: {
    buildId: string
    latestBuildId: () => Promise<string | undefined>
    reload: () => void
    now?: () => number
}) {
    const now = options.now ?? Date.now
    let updatePending = false
    let lastCheck = now()

    return {
        updateAvailable() {
            updatePending = true
        },
        async visible() {
            if (updatePending) return options.reload()
            if (now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return
            lastCheck = now()
            const latest = await options.latestBuildId().catch(() => undefined)
            if (latest && latest !== options.buildId) options.reload()
        },
    }
}
