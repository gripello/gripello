import { locationItems } from '~/composables/useLocations'
import type { LocationRecord } from '~/types/models'

describe('locationItems', () => {
    it('maps locations to select items', () => {
        expect(
            locationItems([{ id: 'l1', name: 'Hall' }] as LocationRecord[]),
        ).toEqual([{ value: 'l1', label: 'Hall' }])
        expect(locationItems(null)).toEqual([])
    })
})
