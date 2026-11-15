import { flushPromises } from '@vue/test-utils'
import { finishOAuth2Reauth } from '~/api/auth'
import { providerConfirmedAt } from '~/utils/providerReauth'
import { runSetup, setupOnly } from '../__stubs__/setupContext'

vi.mock('~/api/auth', () => ({ finishOAuth2Reauth: vi.fn() }))

type Hook = () => Promise<void>

async function startPlugin(path: string, query: Record<string, string>) {
    const hooks: Record<string, Hook> = {}
    const notify = { success: vi.fn(), error: vi.fn() }
    const replace = vi.fn(async () => {})
    vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup)
    vi.stubGlobal(
        'useRouter',
        setupOnly('useRouter', () => ({
            currentRoute: { value: { path, query } },
            replace,
        })),
    )
    vi.stubGlobal(
        'useNotification',
        setupOnly('useNotification', () => notify),
    )
    vi.stubGlobal(
        'useI18n',
        setupOnly('useI18n', () => ({ t: (key: string) => key })),
    )
    const { default: plugin } = await import('~/plugins/oauth2-reauth.client')
    const nuxtApp = {
        $i18n: { t: (key: string) => key },
        hook: (name: string, hook: Hook) => (hooks[name] = hook),
    }
    runSetup(() =>
        (plugin as unknown as (app: typeof nuxtApp) => void)(nuxtApp),
    )
    return { mounted: hooks['app:mounted']!, notify, replace }
}

describe('oauth2 reauth return plugin', () => {
    beforeEach(() => {
        vi.mocked(finishOAuth2Reauth).mockReset()
        providerConfirmedAt.value = 0
    })

    // Catches: composables called after an await in the hook (the app crashed with a 500 after the Custom Tab).
    it('redeems the ticket the app link brought back and says so', async () => {
        vi.mocked(finishOAuth2Reauth).mockResolvedValue(null)
        const { mounted, notify, replace } = await startPlugin(
            '/platform/gyms/g1',
            {
                section: 'danger',
                oauth2Reauth: 'ticket-1',
            },
        )
        await mounted()
        await flushPromises()

        expect(replace).toHaveBeenCalledWith({ query: { section: 'danger' } })
        expect(finishOAuth2Reauth).toHaveBeenCalledWith('ticket-1')
        expect(notify.success).toHaveBeenCalledWith('auth.reauth.repeat')
        expect(providerConfirmedAt.value).toBeGreaterThan(0)
    })

    it('reports a refused ticket and a provider error without confirming', async () => {
        vi.mocked(finishOAuth2Reauth).mockRejectedValue(new Error('refused'))
        const refused = await startPlugin('/platform/gyms/g1', {
            oauth2Reauth: 'stale',
        })
        await refused.mounted()
        const providerError = await startPlugin('/platform/gyms/g1', {
            oauth2ReauthError: 'failed',
        })
        await providerError.mounted()
        await flushPromises()

        expect(refused.notify.error).toHaveBeenCalledWith('auth.reauth.failed')
        expect(providerError.notify.error).toHaveBeenCalledWith(
            'auth.reauth.failed',
        )
        expect(providerConfirmedAt.value).toBe(0)
    })

    it('leaves the popup page and pages without a ticket alone', async () => {
        const popup = await startPlugin('/auth/reauth', {
            oauth2Reauth: 'ticket-1',
        })
        await popup.mounted()
        const plain = await startPlugin('/platform/gyms/g1', {
            section: 'danger',
        })
        await plain.mounted()

        expect(finishOAuth2Reauth).not.toHaveBeenCalled()
        expect(popup.replace).not.toHaveBeenCalled()
        expect(plain.replace).not.toHaveBeenCalled()
    })
})
