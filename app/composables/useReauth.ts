import type { WatchSource } from 'vue'
import { reauthenticate } from '~/api/account'
import { isWrongPassword, needsPasswordFirst } from '~/utils/reauth'
import { throttledErrorKey } from '~/utils/authErrors'
import { providerConfirmationFresh } from '~/utils/providerReauth'

export function useReauth(open?: WatchSource<unknown>) {
    const { t } = useI18n()
    const password = ref('')
    if (open)
        watch(open, (isOpen) => {
            if (isOpen) password.value = ''
        })

    function errorText(fallback: string | ((error: unknown) => string)) {
        return (error: unknown) => {
            if (isWrongPassword(error))
                return t('platform.users.adminPasswordWrong')
            if (needsPasswordFirst(error)) return t('account.passwordRequired')
            const throttled = throttledErrorKey(error)
            if (throttled) return t(throttled)
            return typeof fallback === 'string' ? fallback : fallback(error)
        }
    }

    return {
        password,
        reset: () => (password.value = ''),
        // A fresh provider confirmation already stamped the session; accounts with a password still type it.
        confirm: () =>
            !password.value && providerConfirmationFresh()
                ? Promise.resolve()
                : reauthenticate(password.value),
        errorText,
    }
}
