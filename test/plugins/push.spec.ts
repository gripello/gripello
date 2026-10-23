import { ref } from 'vue'

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
    afterEach(() => vi.doUnmock('~/utils/pushDevice'))

    it('keeps the device registered when a guest signs in', async () => {
        const { onChange, unsubscribe } = await startPlugin()

        onChange('token', { id: 'user1' })

        expect(unsubscribe).not.toHaveBeenCalled()
    })

    it('unsubscribes the device on sign-out and user switch', async () => {
        const { onChange, unsubscribe } = await startPlugin('user1')

        onChange('token', { id: 'user1' })
        expect(unsubscribe).not.toHaveBeenCalled()

        onChange('token', { id: 'user2' })
        onChange('', null)
        expect(unsubscribe).toHaveBeenCalledTimes(2)
    })
})
