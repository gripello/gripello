import { describe, expect, it, vi } from 'vitest'
import { useAuthState } from '~/api/auth'
import { AuthStore } from '~/composables/authStore'
import { connectWidget } from '~/utils/widget'

const token = (n: number) =>
    `x.${btoa(JSON.stringify({ exp: 4102444800, n }))}.y`

function setup(signedIn = false) {
    const plugin = {
        setSession: vi.fn().mockResolvedValue(undefined),
        clearSession: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
    }
    const auth = useAuthState(new AuthStore(''))
    if (signedIn)
        auth.saveAuth({ token: token(1), record: { id: 'u1' } as never })
    const stop = connectWidget(plugin, auth, 'https://gripello.app')
    return { plugin, auth, stop }
}

const setVisibility = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: state,
    })
    document.dispatchEvent(new Event('visibilitychange'))
}

describe('connectWidget', () => {
    it('hands the session to the widget and only a new token again', () => {
        const { plugin, auth, stop } = setup(true)
        expect(plugin.setSession).toHaveBeenCalledWith({
            token: token(1),
            userId: 'u1',
            origin: 'https://gripello.app',
        })
        auth.saveUser({ id: 'u1', name: 'Renamed' } as never)
        expect(plugin.setSession).toHaveBeenCalledTimes(1)

        auth.saveAuth({ token: token(2), record: { id: 'u1' } as never })
        expect(plugin.setSession).toHaveBeenCalledTimes(2)
        expect(plugin.setSession).toHaveBeenLastCalledWith(
            expect.objectContaining({ token: token(2) }),
        )
        stop()
    })

    it('signs the widget out with the app, also a stale widget on start', () => {
        const { plugin, auth, stop } = setup()
        expect(plugin.clearSession).toHaveBeenCalledTimes(1)
        auth.saveAuth({ token: token(1), record: { id: 'u1' } as never })
        auth.clearAuth()
        expect(plugin.clearSession).toHaveBeenCalledTimes(2)
        stop()
    })

    it('redraws the widget when the app goes to the background', () => {
        const { plugin, stop } = setup(true)
        try {
            setVisibility('hidden')
            expect(plugin.reload).toHaveBeenCalledTimes(1)
            setVisibility('visible')
            expect(plugin.reload).toHaveBeenCalledTimes(1)
            stop()
            setVisibility('hidden')
            expect(plugin.reload).toHaveBeenCalledTimes(1)
        } finally {
            delete (document as { visibilityState?: unknown }).visibilityState
        }
    })

    it('keeps the page working when the app build has no widget plugin', async () => {
        const missing = vi.fn().mockRejectedValue(new Error('not implemented'))
        const auth = useAuthState(new AuthStore(''))
        const stop = connectWidget(
            { setSession: missing, clearSession: missing, reload: missing },
            auth,
            'https://gripello.app',
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(missing).toHaveBeenCalled()
        stop()
    })
})
