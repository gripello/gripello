import { getSettings } from '~/api/gyms'
import type { SettingsRecord } from '~/types/models'

export function useSettingsRecord() {
    const { t } = useI18n()
    const { error: notifyError } = useNotification()

    return useAsyncData<SettingsRecord>('settings', async () => {
        try {
            return await getSettings()
        } catch (error) {
            console.error('An error occurred:', error)
            notifyError(t('settings.loadError'))
            throw error
        }
    })
}
