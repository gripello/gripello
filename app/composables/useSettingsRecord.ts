import type { SettingsRecord } from '~/types/models'
import { PLATFORM_SETTINGS_ID } from '#shared/utils/platform'

export function useSettingsRecord() {
    const pb = usePocketbase()
    const { t } = useI18n()
    const { error: notifyError } = useNotification()

    return useAsyncData<SettingsRecord>('settings', async () => {
        try {
            return await pb
                .collection('settings')
                .getOne<SettingsRecord>(PLATFORM_SETTINGS_ID)
        } catch (error) {
            console.error('An error occurred:', error)
            notifyError(t('settings.loadError'))
            throw error
        }
    })
}
