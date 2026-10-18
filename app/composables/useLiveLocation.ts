import type { Ref } from 'vue'
import type { RouteQuery } from '~/api/routes'
import {
    cacheKeys,
    type KeyLocations,
    type KeyQueries,
} from '~/utils/realtimeCache'

export function useLiveLocation(keys: string[], locationId: Ref<string>) {
    const keyLocations = useState<KeyLocations>(
        cacheKeys.keyLocations,
        () => ({}),
    )
    watch(
        locationId,
        (id) => {
            for (const key of keys) keyLocations.value[key] = id
        },
        { immediate: true },
    )
}

// Lets live route changes add rows to or drop them from a list fetched with this query.
export function useLiveQuery(key: string, query: Ref<RouteQuery | null>) {
    const keyQueries = useState<KeyQueries>(cacheKeys.keyQueries, () => ({}))
    watch(
        query,
        (value) => {
            keyQueries.value[key] = value
        },
        { immediate: true, deep: true },
    )
}
