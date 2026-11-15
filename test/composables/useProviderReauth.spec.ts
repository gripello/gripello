import { flushPromises } from '@vue/test-utils'
import { useProviderReauth } from '~/composables/useProviderReauth'
import { startOAuth2 } from '~/api/auth'
import { openSignInPage } from '~/utils/native'

vi.mock('~/api/auth', () => ({
    startOAuth2: vi.fn(async () => ({ url: 'https://idp.example/authorize' })),
}))
vi.mock('~/utils/native', () => ({
    isNativeApp: () => true,
    openSignInPage: vi.fn(async () => undefined),
}))

describe('useProviderReauth in the app', () => {
    beforeEach(() => {
        vi.stubGlobal('useRoute', () => ({
            fullPath: '/platform/gyms/g1?section=danger',
        }))
    })

    it('returns to the asking page and stops spinning once the Custom Tab closes', async () => {
        const { pending, confirmWith } = useProviderReauth()
        await confirmWith('oidc')
        await flushPromises()

        expect(startOAuth2).toHaveBeenCalledWith('oidc', {
            reauth: true,
            redirect: '/platform/gyms/g1?section=danger',
        })
        expect(openSignInPage).toHaveBeenCalledWith(
            'https://idp.example/authorize',
        )
        expect(pending.value).toBe('')
    })
})
