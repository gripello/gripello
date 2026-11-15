import { flushPromises, mount } from '@vue/test-utils'
import ReauthPage from '~/pages/auth/reauth.vue'
import { finishOAuth2Reauth } from '~/api/auth'
import { REAUTH_CHANNEL } from '~/utils/providerReauth'

vi.mock('~/api/auth', () => ({ finishOAuth2Reauth: vi.fn() }))

const posted: unknown[] = []
class FakeChannel {
    constructor(readonly name: string) {}
    postMessage(message: unknown) {
        posted.push([this.name, message])
    }
    close() {}
}

function mountPage(query: Record<string, string>) {
    vi.stubGlobal('definePageMeta', () => {})
    vi.stubGlobal('useHead', () => {})
    vi.stubGlobal('useRoute', () => ({ query }))
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    vi.spyOn(window, 'close').mockImplementation(() => {})
    return mount(ReauthPage, { global: { stubs: { LayoutEmptyState: true } } })
}

describe('auth reauth page', () => {
    beforeEach(() => {
        posted.length = 0
        vi.mocked(finishOAuth2Reauth).mockReset()
    })

    it('redeems the ticket, tells the opener and closes', async () => {
        vi.mocked(finishOAuth2Reauth).mockResolvedValue(null)
        mountPage({ oauth2Reauth: 'ticket-1' })
        await flushPromises()
        expect(finishOAuth2Reauth).toHaveBeenCalledWith('ticket-1')
        expect(posted).toEqual([[REAUTH_CHANNEL, { ok: true }]])
        expect(window.close).toHaveBeenCalled()
    })

    it('reports a refused ticket or a provider error as failed', async () => {
        vi.mocked(finishOAuth2Reauth).mockRejectedValue(new Error('no'))
        mountPage({ oauth2Reauth: 'stale' })
        await flushPromises()
        mountPage({ oauth2ReauthError: 'failed' })
        await flushPromises()
        expect(posted).toEqual([
            [REAUTH_CHANNEL, { ok: false }],
            [REAUTH_CHANNEL, { ok: false }],
        ])
    })
})
