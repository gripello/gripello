import { isAbortError, isRateLimited } from '~/utils/errors'
import { useSessionEnded } from '~/composables/useSessionEnded'

interface AsyncActionMessages {
    success?: string
    error?: string | ((error: unknown) => string)
    handled?: (error: unknown) => boolean
}

export function useAsyncAction() {
    const { t } = useI18n()
    const { success: notifySuccess, error: notifyError } = useNotification()
    const noticeSessionEnded = useSessionEnded()
    const pending = ref(false)

    async function run<TResult>(
        action: () => Promise<TResult>,
        messages: AsyncActionMessages = {},
    ): Promise<TResult | undefined> {
        pending.value = true
        try {
            const result = await action()
            if (messages.success) notifySuccess(messages.success)
            return result
        } catch (error) {
            if (isAbortError(error)) return undefined
            if (messages.handled?.(error) || noticeSessionEnded(error))
                return undefined
            console.error(error)
            notifyError(
                typeof messages.error === 'function'
                    ? messages.error(error)
                    : isRateLimited(error)
                      ? t('errors.rateLimited')
                      : (messages.error ?? t('notifications.error.generic')),
            )
            return undefined
        } finally {
            pending.value = false
        }
    }

    return { pending, run }
}
