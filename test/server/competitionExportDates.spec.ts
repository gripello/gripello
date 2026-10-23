import { describe, expect, it } from 'vitest'
import {
    dateRange,
    safeTimeZone,
} from '../../server/api/ui/competition-export.post'

describe('competition export dates', () => {
    const competition = {
        starts_at: '2026-03-13T23:30:00.000Z',
        ends_at: '2026-03-14T20:00:00.000Z',
    }

    it('dates the competition in the requesting client time zone', () => {
        expect(dateRange(competition, 'en', 'Europe/Berlin')).toBe(
            'March 14, 2026',
        )
        expect(dateRange(competition, 'en', 'UTC')).toBe('March 13 – 14, 2026')
    })

    it('ignores an unknown time zone', () => {
        expect(safeTimeZone('Mars/Olympus')).toBeUndefined()
        expect(safeTimeZone('Europe/Berlin')).toBe('Europe/Berlin')
    })
})
