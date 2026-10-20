import { describe, expect, it } from 'vitest'
import { groupTicksByDay, tickDay } from '#shared/utils/ticks'

describe('ticks', () => {
    it('reads the calendar day of current and cached ticks', () => {
        expect(tickDay('2026-09-26')).toBe('2026-09-26')
        expect(tickDay('2026-09-26 12:00:00.000Z')).toBe('2026-09-26')
        expect(tickDay(null)).toBe('')
    })

    it('groups ticks into sessions, newest day first', () => {
        const ticks = [
            { id: 'a', date: '2026-09-20' },
            { id: 'b', date: '2026-09-26' },
            { id: 'c', date: '2026-09-20' },
        ]
        expect(groupTicksByDay(ticks)).toEqual([
            { day: '2026-09-26', ticks: [ticks[1]] },
            { day: '2026-09-20', ticks: [ticks[0], ticks[2]] },
        ])
        expect(groupTicksByDay([])).toEqual([])
    })
})
