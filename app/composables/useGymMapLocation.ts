import { listWalls } from '~/api/routes'
import { useOfflineData } from '~/composables/useOfflineData'
import { sanitizeGymMap } from '#shared/utils/mapGeometry'
import { toMapWalls } from '~/utils/gymMap'
import { cacheKeys } from '~/utils/realtimeCache'

interface GymMapLocationOptions {
    includeUnmapped?: boolean
    confirmLeave?: () => Promise<boolean>
}

export function defaultMapLocation(
    locations: { id: string; map?: unknown }[],
): string {
    return (
        (
            locations.find(
                (record) => sanitizeGymMap(record.map)?.shapes.length,
            ) ?? locations[0]
        )?.id ?? ''
    )
}

export function useGymMapLocation(
    key: string,
    { includeUnmapped = false, confirmLeave }: GymMapLocationOptions = {},
) {
    const nuxtApp = useNuxtApp()
    const gymId = useCurrentGymId()
    const route = useRoute()
    const router = useRouter()
    const locationsRequest = useLocations()
    const locations = locationsRequest.data

    const selectableLocations = computed(() =>
        includeUnmapped
            ? locations.value
            : locations.value.filter((record) => sanitizeGymMap(record.map)),
    )
    const locationItems = computed(() =>
        selectableLocations.value.map((record) => ({
            title: record.name,
            value: record.id,
        })),
    )
    const locationId = computed({
        get: () =>
            locations.value.some((record) => record.id === route.query.location)
                ? (route.query.location as string)
                : defaultMapLocation(selectableLocations.value),
        set: async (id: string) => {
            if (id === locationId.value) return
            if (confirmLeave && !(await confirmLeave())) return
            void router.replace({ query: { location: id } })
        },
    })
    const location = computed(() =>
        locations.value.find((record) => record.id === locationId.value),
    )
    const map = computed(() => sanitizeGymMap(location.value?.map))

    const wallsKey = cacheKeys.gymWalls(key)
    useLiveLocation([wallsKey], locationId)
    const wallsRequest = useOfflineData(
        wallsKey,
        async () => {
            await locationsRequest
            return locationId.value
                ? nuxtApp.runWithContext(() =>
                      listWalls(gymId.value, { location: locationId.value }),
                  )
                : []
        },
        {
            watch: [locationId],
            default: () => [],
            fits: (rows) =>
                rows.every((row) => row.location === locationId.value),
        },
    )
    const walls = wallsRequest.data
    const mapWalls = computed(() =>
        map.value ? toMapWalls(walls.value, map.value) : [],
    )

    const state = {
        locations,
        refreshLocations: locationsRequest.refresh,
        locationItems,
        locationId,
        location,
        map,
        walls,
        wallsError: wallsRequest.error,
        refreshWalls: wallsRequest.refresh,
        mapWalls,
    }
    return Promise.all([locationsRequest, wallsRequest]).then(() => state)
}
