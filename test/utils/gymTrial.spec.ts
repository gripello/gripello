import { describe, expect, it } from 'vitest'
import { extendedTrialEnd, gymTrial } from '~/utils/gymTrial'

const now = Date.parse('2026-10-19T12:00:00Z')

describe('gymTrial', () => {
    it('is null for gyms without a trial', () => {
        expect(gymTrial({ trial_ends_at: null }, now)).toBeNull()
        expect(gymTrial(null, now)).toBeNull()
    })

    it('counts the days left, rounding up', () => {
        expect(
            gymTrial({ trial_ends_at: '2026-10-21T00:00:00Z' }, now),
        ).toMatchObject({ ended: false, daysLeft: 2 })
    })

    it('marks a past end as ended', () => {
        expect(
            gymTrial({ trial_ends_at: '2026-10-19T11:00:00Z' }, now),
        ).toMatchObject({ ended: true, daysLeft: 0 })
    })
})

describe('extendedTrialEnd', () => {
    it('adds 14 days to a running trial', () => {
        expect(
            extendedTrialEnd({ trial_ends_at: '2026-10-25T12:00:00Z' }, now),
        ).toBe('2026-11-08T12:00:00.000Z')
    })

    it('adds 14 days from today to an ended trial', () => {
        expect(
            extendedTrialEnd({ trial_ends_at: '2026-10-01T00:00:00Z' }, now),
        ).toBe('2026-11-02T12:00:00.000Z')
    })
})
