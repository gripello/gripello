import type { WatchSource } from 'vue'
import { reauthenticate } from '~/api/account'
import { isWrongPassword, needsPasswordFirst } from '~/utils/reauth'

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
            return typeof fallback === 'string' ? fallback : fallback(error)
        }
    }

    return {
        password,
        reset: () => (password.value = ''),
        confirm: () => reauthenticate(password.value),
        errorText,
    }
}
