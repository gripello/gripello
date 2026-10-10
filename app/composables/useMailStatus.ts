import { useApi } from '~/api/client'

export function useMailStatus() {
    return useAsyncData<{ configured: boolean }>(
        'mail-status',
        async () => {
            try {
                return await useApi()<{ configured: boolean }>('/mail-status')
            } catch {
                return { configured: true }
            }
        },
        { default: () => ({ configured: true }) },
    )
}
