process.env.TZ = 'Europe/Berlin'

import { describe, expect, it } from 'vitest'
import { logbookStats, type LogbookTick } from '#shared/utils/logbook'

const tick = (date: string): LogbookTick => ({
    route: `route-${date}`,
    type: 'top',
    attempts: 2,
    date,
    grade: '6A',
    grade_system: 'font',
    grade_index: 15.7,
})

describe('logbook windows across a DST change', () => {
    it('counts calendar days back, not 24-hour blocks', () => {
        const now = new Date(2026, 2, 30, 0, 30)
        const { current, previous } = logbookStats(
            [tick('2026-02-28'), tick('2026-03-01'), tick('2026-01-30')],
            'boulder',
            '30d',
            now,
        )
        expect(current.sends).toBe(1)
        expect(previous?.sends).toBe(2)
    })
})
