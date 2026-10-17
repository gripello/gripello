import { listWalls } from '~/api/routes'
import type { WallRecord } from '~/types/models'

// A slower answer for a location picked earlier must not replace the walls of the current one.
export function useLocationWalls(gymId: Ref<string>, locationId: () => string) {
    const walls = ref<WallRecord[]>([])
    watch(
        locationId,
        async (id) => {
            const loaded = id
                ? await listWalls(gymId.value, { location: id }).catch(() => [])
                : []
            if (locationId() === id) walls.value = loaded
        },
        { immediate: true },
    )
    return walls
}
