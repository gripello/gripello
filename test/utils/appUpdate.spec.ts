import { describe, expect, it, vi } from 'vitest'
import { createUpdateWatcher } from '~/utils/appUpdate'

function watcher(latest: string | undefined) {
    let time = 0
    const reload = vi.fn()
    const latestBuildId = vi.fn(async () => latest)
    const watch = createUpdateWatcher({
        buildId: 'b1',
        latestBuildId,
        reload,
        now: () => time,
    })
    return { watch, reload, latestBuildId, wait: (ms: number) => (time += ms) }
}

describe('createUpdateWatcher', () => {
    it('reloads when the app comes back after an update was announced', async () => {
        const { watch, reload, latestBuildId } = watcher('b1')
        watch.updateAvailable()
        await watch.visible()
        expect(reload).toHaveBeenCalledOnce()
        expect(latestBuildId).not.toHaveBeenCalled()
    })

    it('checks for a newer build on resume at most every five minutes', async () => {
        const { watch, reload, latestBuildId, wait } = watcher('b2')
        await watch.visible()
        expect(latestBuildId).not.toHaveBeenCalled()
        wait(5 * 60_000)
        await watch.visible()
        expect(reload).toHaveBeenCalledOnce()
    })

    it('stays on the current build when it is the latest or the check fails', async () => {
        const current = watcher('b1')
        current.wait(5 * 60_000)
        await current.watch.visible()
        expect(current.reload).not.toHaveBeenCalled()

        const failing = watcher(undefined)
        failing.latestBuildId.mockRejectedValueOnce(new Error('offline'))
        failing.wait(5 * 60_000)
        await failing.watch.visible()
        expect(failing.reload).not.toHaveBeenCalled()
    })
})
