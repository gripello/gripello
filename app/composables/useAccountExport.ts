import { requestDataExport } from '~/api/account'

export function useAccountExport() {
    const { t } = useI18n()
    const { pending, run } = useAsyncAction()
    const requested = ref(false)

    function request() {
        return run(
            async () => {
                await requestDataExport()
                requested.value = true
                return true
            },
            {
                error: (error) =>
                    (error as { status?: number })?.status === 429
                        ? t('account.exportDataRateLimited')
                        : t('notifications.error.generic'),
            },
        )
    }

    return { pending, requested, request }
}
