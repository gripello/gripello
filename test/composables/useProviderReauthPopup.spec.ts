import { flushPromises } from '@vue/test-utils'
import { useProviderReauth } from '~/composables/useProviderReauth'
import {
    providerConfirmation,
    type ReauthMessage,
} from '~/utils/providerReauth'

vi.mock('~/api/auth', () => ({
    startOAuth2: vi.fn(async () => ({ url: 'https://idp.example/authorize' })),
}))
vi.mock('~/utils/native', () => ({
    isNativeApp: () => false,
    openSignInPage: vi.fn(),
}))

let channel:
    { onmessage?: (event: MessageEvent<ReauthMessage>) => void } | undefined
class FakeChannel {
    onmessage?: (event: MessageEvent<ReauthMessage>) => void
    constructor() {
        channel = this
    }
    // A closed channel delivers nothing, like the real one.
    close() {
        this.onmessage = undefined
    }
}

async function openPopup() {
    const popup = { closed: false, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const reauth = useProviderReauth()
    await reauth.confirmWith('oidc')
    await flushPromises()
    return { popup, ...reauth }
}

describe('useProviderReauth in a browser', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.stubGlobal('BroadcastChannel', FakeChannel)
        vi.stubGlobal('useRoute', () => ({ fullPath: '/platform/gyms/g1' }))
        globalThis.__AUTH_STORE__ = { record: { id: 'u1' } }
        providerConfirmation.value = null
        channel = undefined
    })
    afterEach(() => vi.useRealTimers())

    // Catches: the popup closing itself a moment before its "confirmed" message is read.
    it('waits for the message of a popup that just closed itself', async () => {
        const { popup, pending, failed, confirmed } = await openPopup()
        expect(popup.location.href).toBe('https://idp.example/authorize')

        popup.closed = true
        vi.advanceTimersByTime(500)
        channel?.onmessage?.({
            data: { ok: true },
        } as MessageEvent<ReauthMessage>)

        expect(failed.value).toBe(false)
        expect(pending.value).toBe('')
        expect(confirmed.value).toBe(true)
        expect(providerConfirmation.value?.user).toBe('u1')
    })

    it('gives up when the popup closes without an answer', async () => {
        const { popup, pending, failed, confirmed } = await openPopup()
        popup.closed = true
        vi.advanceTimersByTime(1000)

        expect(failed.value).toBe(true)
        expect(pending.value).toBe('')
        expect(confirmed.value).toBe(false)
    })
})
