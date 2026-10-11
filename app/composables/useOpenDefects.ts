import type { OpenRouteDefectRecord } from '~/types/models'
import { listOpenDefects } from '~/api/tasks'
import { cacheKeys } from '~/utils/realtimeCache'
import { defectSeverityByRoute } from '~/utils/tasks'

export function useOpenDefects() {
    const gymId = useCurrentGymId()
    const { data, refresh } = useAsyncData(
        cacheKeys.openDefects,
        () =>
            listOpenDefects(gymId.value).catch(
                () => [] as OpenRouteDefectRecord[],
            ),
        { default: () => [] },
    )

    return {
        defectsByRoute: computed(() => defectSeverityByRoute(data.value)),
        refreshOpenDefects: refresh,
    }
}
