import type { WatchSource } from 'vue'
import { reauthenticate } from '~/api/account'
import { isWrongPassword, needsPasswordFirst } from '~/utils/reauth'
import { throttledErrorKey } from '~/utils/authErrors'
import {
    accountWithoutPassword,
    ProviderConfirmationMissing,
    providerConfirmationFresh,
} from '~/utils/providerReauth'

export function useReauth(open?: WatchSource<unknown>) {
    const { t } = useI18n()
    const password = ref('')
    if (open)
        watch(open, (isOpen) => {
            if (isOpen) password.value = ''
        })

    function errorText(fallback: string | ((error: unknown) => string)) {
        return (error: unknown) => {
            if (error instanceof ProviderConfirmationMissing)
                return t('auth.reauth.required')
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
        confirm: () => {
            if (!password.value && providerConfirmationFresh())
                return Promise.resolve()
            if (!password.value && accountWithoutPassword.value)
                return Promise.reject(new ProviderConfirmationMissing())
            return reauthenticate(password.value)
        },
        errorText,
    }
}
