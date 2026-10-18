import { computed, ref, watch } from 'vue'
import { useRouteFilters } from '~/composables/useRouteFilters'

describe('useRouteFilters', () => {
    it('keeps the wall list of each page under its own key', () => {
        const keys: string[] = []
        const liveKeys: string[][] = []
        vi.stubGlobal('ref', ref)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
        vi.stubGlobal('useLocations', () => ({ data: ref([]) }))
        vi.stubGlobal('useGradeSystems', () => ({ gradeFilterItems: ref([]) }))
        vi.stubGlobal('useCurrentGymId', () => ref('gym1'))
        vi.stubGlobal('useAsyncData', (key: string) => {
            keys.push(key)
            return { data: ref([]) }
        })
        vi.stubGlobal('useLiveLocation', (live: string[]) =>
            liveKeys.push(live),
        )

        useRouteFilters('routes')
        useRouteFilters('map')

        expect(keys).toEqual(['routes-filter-walls', 'map-filter-walls'])
        expect(liveKeys).toEqual([
            ['routes-filter-walls'],
            ['map-filter-walls'],
        ])
    })
})
