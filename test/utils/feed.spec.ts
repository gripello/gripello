import { describe, expect, it } from 'vitest'
import { activityDayLabel, activityDays } from '~/utils/feed'
import type { FeedTick } from '~/utils/friends'

const tick = (id: string, day: string, created: string): FeedTick => ({
    id,
    user: 'anna',
    type: 'top',
    attempts: 1,
    date: `${day} 12:00:00.000Z`,
    created,
})

describe('activityDays', () => {
    it('groups sends per day, newest day and newest send first', () => {
        const days = activityDays([
            tick('a', '2026-10-01', '2026-10-01 09:00'),
            tick('b', '2026-10-02', '2026-10-02 08:00'),
            tick('c', '2026-10-01', '2026-10-01 18:00'),
        ])
        expect(
            days.map(({ day, ticks }) => [day, ticks.map((t) => t.id)]),
        ).toEqual([
            ['2026-10-02', ['b']],
            ['2026-10-01', ['c', 'a']],
        ])
    })

    it('is empty without sends', () => {
        expect(activityDays([])).toEqual([])
    })
})

describe('activityDayLabel', () => {
    it('names today and yesterday, formats older days', () => {
        const now = new Date(2026, 9, 5, 12)
        const t = (key: string) => key
        expect(activityDayLabel('2026-10-05', t, 'en', now)).toBe('feed.today')
        expect(activityDayLabel('2026-10-04', t, 'en', now)).toBe(
            'feed.yesterday',
        )
        expect(activityDayLabel('2026-10-01', t, 'en', now)).toContain(
            'October',
        )
    })

    it('formats the date without a clock so server and client agree', () => {
        const t = (key: string) => key
        expect(activityDayLabel('2026-10-05', t, 'en', null)).toContain(
            'October',
        )
    })
})
