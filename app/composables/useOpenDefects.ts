import type { OpenRouteDefectRecord } from '~/types/models'
import { keepWhenOffline } from '~/utils/errors'
import { listOpenDefects } from '~/api/tasks'
import { cacheKeys } from '~/utils/realtimeCache'
import { isOfflineError } from '~/utils/tickOutbox'
import { defectSeverityByRoute } from '~/utils/tasks'

export function useOpenDefects() {
    const gymId = useCurrentGymId()
    const { data, refresh } = useAsyncData(
        cacheKeys.openDefects,
        (nuxtApp) =>
            keepWhenOffline(nuxtApp, cacheKeys.openDefects, () =>
                listOpenDefects(gymId.value).catch((err) => {
                    if (isOfflineError(err)) throw err
                    return [] as OpenRouteDefectRecord[]
                }),
            ),
        { default: () => [] },
    )

    return {
        defectsByRoute: computed(() => defectSeverityByRoute(data.value)),
        refreshOpenDefects: refresh,
    }
}
