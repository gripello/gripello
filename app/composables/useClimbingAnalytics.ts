import type { AnalyticsQuery, AnalyticsResponse } from '#shared/utils/analytics'
import { gymChangesTopic, type GymChange } from '~/utils/realtimeCache'

const QUERY_KEYS = [
    'range',
    'from',
    'to',
    'location',
    'type',
    'archived',
] as const
const LIVE_DEBOUNCE_MS = 2000

export function useClimbingAnalytics() {
    const route = useRoute()
    const router = useRouter()
    const authStore = useAuthStore()
    const requestFetch = useRequestFetch()
    const gymId = useCurrentGymId()

    const query = computed<AnalyticsQuery>(() =>
        Object.fromEntries(
            QUERY_KEYS.flatMap((key) => {
                const value = route.query[key]
                return typeof value === 'string' && value ? [[key, value]] : []
            }),
        ),
    )

    function updateQuery(patch: Partial<AnalyticsQuery>) {
        const next = { ...route.query, ...patch }
        void router.replace({
            query: Object.fromEntries(
                Object.entries(next).filter(([, value]) => value),
            ),
        })
    }

    const { data, status, error, refresh } = useAsyncData(
        'climbing-analytics',
        () =>
            requestFetch<AnalyticsResponse>('/api/manage/analytics', {
                query: { ...query.value, gym: gymId.value },
                headers: authStore.token
                    ? { Authorization: authStore.token }
                    : undefined,
            }),
        { watch: [query, gymId], enabled: () => !!gymId.value },
    )

    const initialLoading = computed(
        () => status.value === 'pending' && !data.value,
    )

    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let staleWhileHidden = false

    function scheduleRefresh() {
        if (refreshTimer) return
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined
            if (document.visibilityState === 'hidden') {
                staleWhileHidden = true
                return
            }
            void refresh()
        }, LIVE_DEBOUNCE_MS)
    }

    function refreshIfStale() {
        if (document.visibilityState !== 'visible' || !staleWhileHidden) return
        staleWhileHidden = false
        void refresh()
    }

    useRealtime(
        () => gymId.value && gymChangesTopic(gymId.value),
        (change: GymChange) => {
            if (
                change.collection === 'routes' ||
                change.collection === 'ratings'
            )
                scheduleRefresh()
        },
    )

    onMounted(() =>
        document.addEventListener('visibilitychange', refreshIfStale),
    )

    onBeforeUnmount(() => {
        clearTimeout(refreshTimer)
        document.removeEventListener('visibilitychange', refreshIfStale)
    })

    return {
        query,
        updateQuery,
        analytics: data,
        initialLoading,
        error,
    }
}
