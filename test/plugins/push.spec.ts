import { ref } from 'vue'
import { PUSH_DEVICE_USER_KEY } from '~/utils/push'

type AuthChange = (token: string, record: { id: string } | null) => void

async function startPlugin(signedInAs?: string) {
    let onChange!: AuthChange
    const unsubscribe = vi.fn(() => Promise.resolve())
    vi.resetModules()
    vi.doMock('~/utils/pushDevice', () => ({
        pushDevice: () => ({ unsubscribe }),
    }))
    vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup)
    vi.stubGlobal('useFollowedWalls', () => ({ followed: ref([]) }))
    vi.stubGlobal('useAuthStore', () => ({
        record: signedInAs ? { id: signedInAs } : null,
        onChange: (callback: AuthChange) => (onChange = callback),
    }))
    const { default: plugin } = await import('~/plugins/push.client')
    ;(plugin as unknown as () => void)()
    return { onChange, unsubscribe }
}

describe('push plugin', () => {
    beforeEach(() => localStorage.clear())
    afterEach(() => vi.doUnmock('~/utils/pushDevice'))

    it('keeps the device registered when a guest signs in', async () => {
        const { onChange, unsubscribe } = await startPlugin()

        onChange('token', { id: 'user1' })

        expect(unsubscribe).not.toHaveBeenCalled()
    })

    it('keeps it when the same climber signs in again after the session ran out', async () => {
        localStorage.setItem(PUSH_DEVICE_USER_KEY, 'user1')
        const { onChange, unsubscribe } = await startPlugin()

        onChange('token', { id: 'user1' })

        expect(unsubscribe).not.toHaveBeenCalled()
    })

    it("stops the previous climber's push when someone else signs in after their session ran out", async () => {
        localStorage.setItem(PUSH_DEVICE_USER_KEY, 'user1')
        const { onChange, unsubscribe } = await startPlugin()

        onChange('token', { id: 'user2' })

        expect(unsubscribe).toHaveBeenCalledTimes(1)
        expect(localStorage.getItem(PUSH_DEVICE_USER_KEY)).toBe('user2')
    })

    it('unsubscribes the device on sign-out and user switch', async () => {
        const { onChange, unsubscribe } = await startPlugin('user1')

        onChange('token', { id: 'user1' })
        expect(unsubscribe).not.toHaveBeenCalled()

        onChange('token', { id: 'user2' })
        onChange('', null)
        expect(unsubscribe).toHaveBeenCalledTimes(2)
        expect(localStorage.getItem(PUSH_DEVICE_USER_KEY)).toBeNull()
    })
})
