import { updatedGym } from '~/composables/useLiveGym'
import type { GymRecord } from '~/types/models'

describe('updatedGym', () => {
    const gym = { id: 'g1', name: 'Old' } as GymRecord

    it('takes the record of an update to the shown gym', () => {
        const record = { id: 'g1', name: 'New' } as GymRecord
        expect(updatedGym(gym, { kind: 'gym.updated', record })).toBe(record)
    })

    it('keeps the trial end that gym events leave out', () => {
        const trial = { ...gym, trial_ends_at: '2026-11-18T00:00:00Z' }
        const record = { id: 'g1', name: 'New' } as GymRecord
        expect(updatedGym(trial, { kind: 'gym.updated', record })).toEqual({
            ...record,
            trial_ends_at: '2026-11-18T00:00:00Z',
        })
    })

    it('applies a trial change to the shown gym only', () => {
        const event = {
            kind: 'gym.trial_changed' as const,
            gym: 'g1',
            trial_ends_at: null,
        }
        expect(
            updatedGym(
                { ...gym, trial_ends_at: '2026-11-18T00:00:00Z' },
                event,
            ),
        ).toEqual({ ...gym, trial_ends_at: null })
        expect(updatedGym(gym, { ...event, gym: 'g2' })).toBe(null)
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
