import type { GymRecord } from '~/types/models'
import { hasLocation, preferredDirections } from '~/utils/gymInfo'

export function useDirectionsHref(
    gym: MaybeRefOrGetter<
        Pick<GymRecord, 'latitude' | 'longitude' | 'address'>
    >,
) {
    const userAgent = ref('')
    onMounted(() => (userAgent.value = navigator.userAgent))
    return computed(() => {
        const value = toValue(gym)
        return hasLocation(value)
            ? preferredDirections(value, userAgent.value)
            : ''
    })
}
