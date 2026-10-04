import { saveBlob } from '~/utils/download'

export function useAccountExport() {
    const pb = usePocketbase()
    const { t } = useI18n()
    const { pending, run } = useAsyncAction()

    function download() {
        return run(
            async () => {
                const response = await fetch(
                    pb.buildURL('/api/account/export'),
                    { headers: { Authorization: pb.authStore.token } },
                )
                if (!response.ok) throw response
                saveBlob(
                    await response.blob(),
                    `gripello-data-${new Date().toISOString().slice(0, 10)}.zip`,
                )
                return true
            },
            {
                error: (error) =>
                    error instanceof Response && error.status === 429
                        ? t('account.exportDataRateLimited')
                        : t('notifications.error.generic'),
            },
        )
    }

    return { pending, download }
}
