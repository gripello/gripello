import { nextTick, ref } from 'vue'
import { useReauth } from '~/composables/useReauth'

const reauthenticate = vi.fn()
vi.mock('~/api/account', () => ({
    reauthenticate: (password: string) => reauthenticate(password),
}))

const fieldError = (code: string) => ({
    response: { data: { password: { code } } },
})

describe('useReauth', () => {
    beforeEach(() => reauthenticate.mockReset())

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
