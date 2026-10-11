import { listWalls } from '~/api/routes'
import { cacheKeys } from '~/utils/realtimeCache'
import { ROUTE_TYPES } from '~/utils/routes'
import { routeFilterQuery } from '~/utils/routeSearch'
import type { WallRecord } from '~/types/models'

export function useRouteFilters() {
    const { t } = useI18n()
    const { data: locationRecords } = useLocations()
    const { gradeFilterItems } = useGradeSystems()
    const gymId = useCurrentGymId()

    const searchRouteName = ref('')
    const selectedDifficulty = ref('')
    const selectedType = ref('')
    const selectedLocation = ref('')
    const selectedWall = ref('')

    const { data: wallRecords } = useAsyncData(
        cacheKeys.routeFilterWalls,
        () =>
            selectedLocation.value
                ? listWalls(
                      gymId.value,
                      { location: selectedLocation.value },
                      { fields: 'id,name', requestKey: null },
                  )
                : Promise.resolve([] as WallRecord[]),
        { default: () => [], server: false, watch: [selectedLocation] },
    )
    useLiveLocation([cacheKeys.routeFilterWalls], selectedLocation)

    watch(selectedLocation, () => {
        selectedWall.value = ''
    })

    const walls = computed(() => [
        { text: t('filter.all'), value: '' },
        ...wallRecords.value.map((wall) => ({
            text: wall.name,
            value: wall.id,
        })),
    ])

    const difficulties = computed(() => [
        { text: t('filter.all'), value: '' },
        ...gradeFilterItems.value,
    ])

    const types = computed(() => [
        { text: t('filter.all'), value: '' },
        ...ROUTE_TYPES.map((value) => ({
            text: t(`routes.types.${value.toLowerCase()}`),
            value,
        })),
    ])

    const locations = computed(() => [
        { text: t('filter.all'), value: '' },
        ...locationRecords.value.map((location) => ({
            text: location.name,
            value: location.id,
        })),
    ])

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
