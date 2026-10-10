import { saveBlob } from '~/utils/download'
import { exportMyData } from '~/api/account'

export function useAccountExport() {
    const { t } = useI18n()
    const { pending, run } = useAsyncAction()

    function download() {
        return run(
            async () => {
                saveBlob(
                    await exportMyData(),
                    `gripello-data-${new Date().toISOString().slice(0, 10)}.zip`,
                )
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

    return { pending, download }
}
