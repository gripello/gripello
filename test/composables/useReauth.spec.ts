import { nextTick, ref } from 'vue'
import { useReauth } from '~/composables/useReauth'
import {
    markProviderConfirmed,
    providerConfirmedAt,
} from '~/utils/providerReauth'

const reauthenticate = vi.fn()
vi.mock('~/api/account', () => ({
    reauthenticate: (password: string) => reauthenticate(password),
}))

const fieldError = (code: string) => ({
    response: { data: { password: { code } } },
})

describe('useReauth', () => {
    beforeEach(() => {
        reauthenticate.mockReset()
        providerConfirmedAt.value = 0
    })

    it('skips the password check right after a provider confirmation', async () => {
        const { confirm } = useReauth()
        markProviderConfirmed()
        await confirm()
        expect(reauthenticate).not.toHaveBeenCalled()
    })

    it('asks the server again once the provider confirmation is old', async () => {
        const { confirm } = useReauth()
        markProviderConfirmed(Date.now() - 5 * 60_000)
        await confirm()
        expect(reauthenticate).toHaveBeenCalledWith('')
    })

    it('still checks a typed password after a provider confirmation', async () => {
        const { password, confirm } = useReauth()
        markProviderConfirmed()
        password.value = 'secret'
        await confirm()
        expect(reauthenticate).toHaveBeenCalledWith('secret')
    })

    it('clears the password whenever the dialog opens', async () => {
        const open = ref(false)
        const { password } = useReauth(open)
        password.value = 'old'
        open.value = true
        await nextTick()
        expect(password.value).toBe('')
    })

    it('confirms with the typed password', async () => {
        const { password, confirm } = useReauth()
        password.value = 'secret'
        await confirm()
        expect(reauthenticate).toHaveBeenCalledWith('secret')
    })

    it('explains wrong and missing passwords before the fallback', () => {
        const { errorText } = useReauth()
        const text = errorText((error) =>
            (error as { status?: number }).status === 400 ? 'last' : 'generic',
        )
        expect(text(fieldError('invalid_password'))).toBe(
            'platform.users.adminPasswordWrong',
        )
        expect(text(fieldError('password_required'))).toBe(
            'account.passwordRequired',
        )
        expect(text({ status: 400 })).toBe('last')
        expect(errorText('saveError')(new Error('x'))).toBe('saveError')
    })

    it('explains a lockout instead of the fallback', () => {
        const text = useReauth().errorText('generic')
        expect(
            text({
                status: 429,
                data: { message: 'Account temporarily locked.' },
            }),
        ).toBe('notifications.error.account_locked')
        expect(
            text({ status: 429, data: { message: 'Too many requests.' } }),
        ).toBe('errors.rateLimited')
    })
})
