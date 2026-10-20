import { ROUTE_TYPES } from '#shared/utils/routeTypes'
import { listWalls } from '~/api/routes'
import { cacheKeys } from '~/utils/realtimeCache'
import { routeFilterQuery } from '~/utils/routeSearch'
import type { WallRecord } from '~/types/models'

export function useRouteFilters(scope: string) {
    const { t } = useI18n()
    const { items: locations } = useLocations()
    const { gradeFilterItems } = useGradeSystems()
    const gymId = useCurrentGymId()

    const searchRouteName = ref('')
    const selectedDifficulty = ref('')
    const selectedType = ref('')
    const selectedLocation = ref('')
    const selectedWall = ref('')

    const wallsKey = cacheKeys.routeFilterWalls(scope)
    const { data: wallRecords } = useAsyncData(
        wallsKey,
        () =>
            selectedLocation.value
                ? listWalls(gymId.value, { location: selectedLocation.value })
                : Promise.resolve([] as WallRecord[]),
        { default: () => [], server: false, watch: [selectedLocation] },
    )
    useLiveLocation([wallsKey], selectedLocation)

    watch(selectedLocation, () => {
        selectedWall.value = ''
    })

    const walls = computed(() =>
        wallRecords.value.map((wall) => ({ text: wall.name, value: wall.id })),
    )

    const difficulties = gradeFilterItems

    const types = computed(() =>
        ROUTE_TYPES.map((value) => ({
            text: t(`routes.types.${value.toLowerCase()}`),
            value,
        })),
    )

    const activeFilterCount = computed(
        () =>
            [
                selectedDifficulty.value,
                selectedType.value,
                selectedLocation.value,
                selectedWall.value,
            ].filter(Boolean).length,
    )

    const routeQuery = computed(() =>
        routeFilterQuery({
            difficulty: selectedDifficulty.value,
            location: selectedLocation.value,
            wall: selectedWall.value,
            type: selectedType.value,
            search: searchRouteName.value,
        }),
    )

    function clearFilters() {
        searchRouteName.value = ''
        selectedDifficulty.value = ''
        selectedType.value = ''
        selectedLocation.value = ''
        selectedWall.value = ''
    }

    return {
        searchRouteName,
        selectedDifficulty,
        selectedType,
        selectedLocation,
        selectedWall,
        difficulties,
        types,
        locations,
        walls,
        activeFilterCount,
        routeQuery,
        clearFilters,
    }
}
