import { describe, expect, it } from 'vitest'
import {
    changedGymSettings,
    emptyContact,
    gymSettingsDraft,
} from '~/utils/gymSettingsDraft'
import type { GymRecord } from '~/types/models'

const bands = () => [{ key: 'a', name: 'A', from: 0, to: 1, color: '#000' }]

describe('gym settings draft', () => {
    it('fills defaults for a gym without settings', () => {
        const draft = gymSettingsDraft(null, bands as never)
        expect(draft.name).toBe('')
        expect(draft.language).toBeTruthy()
        expect(draft.boulder_bands).toEqual(bands())
        expect(draft.opening_hours.mon).toEqual([])
    })

    it('copies nested values so editing never touches the record', () => {
        const gym = {
            previous_slugs: ['old'],
            opening_hours: { mon: [['07:00', '22:00']] },
        } as unknown as GymRecord
        const draft = gymSettingsDraft(gym, bands as never)
        draft.previous_slugs.push('x')
        draft.opening_hours.mon[0]![0] = '08:00'
        expect(gym.previous_slugs).toEqual(['old'])
        expect(gym.opening_hours!.mon![0]![0]).toBe('07:00')
    })

    it('sends only the changed fields, short name included', () => {
        const pristine = gymSettingsDraft(
            { name: 'Gym', short_name: 'G' } as GymRecord,
            bands as never,
        )
        const draft = gymSettingsDraft(
            { name: 'Gym', short_name: 'G' } as GymRecord,
            bands as never,
        )
        expect(changedGymSettings(draft, pristine)).toEqual({})
        draft.short_name = 'GG'
        draft.boulder_bands[0]!.name = ' A '
        expect(changedGymSettings(draft, pristine)).toEqual({
            short_name: 'GG',
        })
    })

    it('sends contacts without blank rows, blank fields or a title outside other', () => {
        const record = {
            contacts: [{ kind: 'privacy', email: 'dpo@gym.test' }],
        } as unknown as GymRecord
        const pristine = gymSettingsDraft(record, bands as never)
        const draft = gymSettingsDraft(record, bands as never)
        expect(draft.contacts[0]).toEqual({
            ...emptyContact(),
            kind: 'privacy',
            email: 'dpo@gym.test',
        })
        expect(changedGymSettings(draft, pristine)).toEqual({})
        draft.contacts[0]!.name = ' Jana '
        draft.contacts[0]!.label = 'DPO'
        draft.contacts.push(emptyContact())
        draft.contacts.push({
            ...emptyContact(),
            kind: 'other',
            label: 'Youth',
            phone: '0123',
        })
        expect(changedGymSettings(draft, pristine)).toEqual({
            contacts: [
                { kind: 'privacy', name: 'Jana', email: 'dpo@gym.test' },
                { kind: 'other', label: 'Youth', phone: '0123' },
            ],
        })
    })

    it('sends bands as exactly name, colour and upper grade', () => {
        const record = {
            boulder_bands: [
                { name: 'Green', color: '#00ff00', to: '5', key: 'x', span: 3 },
            ],
        } as unknown as GymRecord
        const pristine = gymSettingsDraft(null, bands as never)
        const draft = gymSettingsDraft(record, bands as never)
        expect(draft.boulder_bands).toEqual([
            { name: 'Green', color: '#00ff00', to: '5' },
        ])
        Object.assign(draft.boulder_bands[0]!, { from: 0, label: 'x' })
        draft.boulder_bands[0]!.name = ' Green '
        expect(changedGymSettings(draft, pristine).boulder_bands).toEqual([
            { name: 'Green', color: '#00ff00', to: '5' },
        ])
    })
})
