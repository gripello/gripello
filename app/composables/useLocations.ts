import type { LocationRecord } from '~/types/models'
import { sharedAsyncData } from '~/utils/asyncData'

export function useLocations() {
    const pb = usePocketbase()
    const gymId = useCurrentGymId()

    return useAsyncData<LocationRecord[]>(
        'locations',
        () =>
            pb.collection('locations').getFullList<LocationRecord>({
                filter: gymFilter(pb, gymId.value),
                sort: 'name',
                requestKey: 'locationsList',
            }),
        { ...sharedAsyncData, default: () => [] },
    )
}
