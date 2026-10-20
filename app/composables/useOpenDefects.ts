import { isOfflineError } from '~/utils/errors'
import type { OpenRouteDefectRecord } from '~/types/models'
import { useOfflineData } from '~/composables/useOfflineData'
import { listOpenDefects } from '~/api/tasks'
import { cacheKeys } from '~/utils/realtimeCache'
import { defectSeverityByRoute } from '~/utils/tasks'

export function useOpenDefects() {
    const gymId = useCurrentGymId()
    const { data, refresh } = useOfflineData(
        cacheKeys.openDefects,
        () =>
            listOpenDefects(gymId.value).catch((err) => {
                if (isOfflineError(err)) throw err
                return [] as OpenRouteDefectRecord[]
            }),
        { default: () => [] },
    )

    return {
        defectsByRoute: computed(() => defectSeverityByRoute(data.value)),
        refreshOpenDefects: refresh,
    }
}
