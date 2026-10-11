import { listLocations } from '~/api/routes'
import type { LocationRecord } from '~/types/models'
import { sharedAsyncData } from '~/utils/asyncData'

export function useLocations() {
    const gymId = useCurrentGymId()

    return useAsyncData<LocationRecord[]>(
        'locations',
        () => listLocations(gymId.value, { requestKey: 'locationsList' }),
        { ...sharedAsyncData, default: () => [] },
    )
}
