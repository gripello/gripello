import { labelAnalytics, type AnalyticsQuery } from '#shared/utils/analytics'
import { getAnalytics } from '~/api/routes'
import {
    coalesce,
    gymChangesTopic,
    type GymChange,
} from '~/utils/realtimeCache'

const QUERY_KEYS = [
    'range',
    'from',
    'to',
    'location',
    'type',
    'archived',
] as const
const LIVE_DEBOUNCE_MS = 1000

export function useClimbingAnalytics() {
    const route = useRoute()
    const router = useRouter()
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
        async () =>
            labelAnalytics(await getAnalytics(gymId.value, query.value)),
        { watch: [query, gymId], enabled: () => !!gymId.value },
    )

    const initialLoading = computed(
        () => status.value === 'pending' && !data.value,
    )

    const scheduleRefresh = coalesce(() => refresh(), LIVE_DEBOUNCE_MS)

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

    return {
        query,
        updateQuery,
        analytics: data,
        initialLoading,
        error,
    }
}
