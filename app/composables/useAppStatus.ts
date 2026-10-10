import { useApi } from '~/api/client'
import { useAuthState } from '~/api/auth'

export function useAppStatus() {
    const api = useApi()
    const auth = useAuthState()

    const { data: healthy } = useAsyncData(
        'footer:health',
        () =>
            api('/health').then(
                () => true,
                () => false,
            ),
        { default: () => false, lazy: true, server: false },
    )

    const { data: online } = useAsyncData(
        'footer:online',
        () => api<{ clients: number }>('/online'),
        {
            default: () => ({ clients: 0 }),
            lazy: true,
            server: false,
            enabled: () => auth.isSignedIn(),
        },
    )

    return {
        isHealthy: computed(() => healthy.value === true),
        onlineCount: computed(() => (online.value?.clients ?? 0) + 1),
    }
}
