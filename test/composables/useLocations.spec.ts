import { ref } from 'vue'

const { listLocations } = vi.hoisted(() => ({ listLocations: vi.fn() }))
vi.mock('~/api/routes', () => ({ listLocations }))
import { locationItems, useLocations } from '~/composables/useLocations'
import type { LocationRecord } from '~/types/models'

describe('locationItems', () => {
    it('maps locations to select items', () => {
        expect(
            locationItems([{ id: 'l1', name: 'Hall' }] as LocationRecord[]),
        ).toEqual([{ value: 'l1', label: 'Hall' }])
        expect(locationItems(null)).toEqual([])
    })
})

describe('useLocations', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('keeps the loaded locations when a refresh fails without network', async () => {
        const offline = Object.assign(new Error('Failed to fetch'), {
            status: 0,
        })
        const hall = { id: 'l1', name: 'Hall' }
        let load!: (nuxtApp: unknown) => Promise<unknown>
        vi.stubGlobal('useCurrentGymId', () => ref('gym'))
        vi.stubGlobal('useAsyncData', (_key: string, handler: typeof load) => {
            load = handler
            return { data: ref([]) }
        })
        listLocations.mockRejectedValue(offline)

        useLocations()

        await expect(
            load({
                _asyncData: {
                    locations: {
                        data: { value: [hall] },
                        error: { value: undefined },
                    },
                },
                payload: { data: { locations: [hall] } },
            }),
        ).resolves.toEqual([hall])
    })
})
