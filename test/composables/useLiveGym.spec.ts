import { updatedGym } from '~/composables/useLiveGym'
import type { GymRecord } from '~/types/models'

describe('updatedGym', () => {
    const gym = { id: 'g1', name: 'Old' } as GymRecord

    it('takes the record of an update to the shown gym', () => {
        const record = { id: 'g1', name: 'New' } as GymRecord
        expect(updatedGym(gym, { kind: 'gym.updated', record })).toBe(record)
    })

    it('ignores other gyms and other kinds', () => {
        const other = { id: 'g2' } as GymRecord
        expect(updatedGym(gym, { kind: 'gym.updated', record: other })).toBe(
            null,
        )
        expect(
            updatedGym(gym, {
                kind: 'role.changed',
                action: 'update',
                id: 'r1',
                gym: 'g1',
            }),
        ).toBe(null)
    })
})
