import { describe, expect, it } from 'vitest'
import {
    formatTrend,
    gymGoingQuiet,
    insightDayLabel,
    insightRate,
    insightTrend,
    sortInsightGyms,
} from '~/utils/platformInsights'

describe('platform insights', () => {
    it('gives no rate for a hidden count or an empty base', () => {
        expect(insightRate(3, 12)).toBe(0.25)
        expect(insightRate(null, 12)).toBeNull()
        expect(insightRate(3, null)).toBeNull()
        expect(insightRate(0, 0)).toBeNull()
    })

    it('compares with the previous range only when it had usage', () => {
        expect(insightTrend(15, 10)).toBe(0.5)
        expect(insightTrend(5, 0)).toBeNull()
    })

    it('labels a day without shifting it into another time zone', () => {
        expect(insightDayLabel('2026-11-01', 'en')).toBe('Nov 1')
    })

    it('calls a gym quiet once its logs halved from a real baseline', () => {
        expect(gymGoingQuiet(9, 20)).toBe(true)
        expect(gymGoingQuiet(10, 20)).toBe(false)
        expect(gymGoingQuiet(0, 19)).toBe(false)
    })

    it('sorts gyms by logs or by the biggest drop', () => {
        const gyms = [
            { id: 'a', logs: 50, previous_logs: 40 },
            { id: 'b', logs: 10, previous_logs: 40 },
            { id: 'c', logs: 30, previous_logs: 0 },
        ]
        expect(sortInsightGyms(gyms, 'logs').map((g) => g.id)).toEqual([
            'a',
            'c',
            'b',
        ])
        expect(sortInsightGyms(gyms, 'drop').map((g) => g.id)).toEqual([
            'b',
            'c',
            'a',
        ])
    })

    it('shows trends as whole percentages with a sign', () => {
        expect(formatTrend(-0.9683, 'en')).toBe('-97%')
        expect(formatTrend(0.2, 'en')).toBe('+20%')
        expect(formatTrend(0, 'en')).toBe('0%')
    })
})
