import { useApi } from '~/api/client'
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { useAuthState } from '~/api/auth'

const HEALTH_RECHECK_MS = 300_000

export function useAppStatus() {
    const api = useApi()
    const auth = useAuthState()

    const { data: healthy, refresh: recheck } = useAsyncData<boolean | null>(
        'footer:health',
        () =>
            api<{ status?: string }>('/health').then(
                (health) => health.status === 'ok',
                () => false,
            ),
        { default: () => null, lazy: true, server: false },
    )
    useIntervalFn(() => {
        if (document.visibilityState === 'visible') void recheck()
    }, HEALTH_RECHECK_MS)
    useEventListener('online', () => void recheck())
    let wasHidden = false
    useEventListener(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') wasHidden = true
        else if (wasHidden) {
            wasHidden = false
            void recheck()
        }
    })

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
        isHealthy: computed(() => healthy.value !== false),
        onlineCount: computed(() => (online.value?.clients ?? 0) + 1),
    }
}
