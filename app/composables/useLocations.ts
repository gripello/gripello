import { listLocations } from '~/api/routes'
import type { LocationRecord } from '~/types/models'
import { sharedAsyncData } from '~/utils/asyncData'

export function locationItems(locations: LocationRecord[] | null | undefined) {
    return (locations ?? []).map(({ id, name }) => ({ value: id, label: name }))
}

export function useLocations() {
    const gymId = useCurrentGymId()
    const request = useAsyncData<LocationRecord[]>(
        'locations',
        () => listLocations(gymId.value),
        { ...sharedAsyncData, default: () => [] },
    )
    return Object.assign(request, {
        items: computed(() => locationItems(request.data.value)),
    })
}
