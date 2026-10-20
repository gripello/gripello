import { describe, expect, it } from 'vitest'
import { podiumRank } from '~/utils/themeColors'

describe('podiumRank', () => {
    it('keeps the rank of an entrant with a score', () => {
        expect(podiumRank({ rank: 1, points: 0, tops: 0, zones: 1 })).toBe(1)
        expect(podiumRank({ rank: 2, points: 12.5, tops: 0, zones: 0 })).toBe(2)
    })

    it('gives no podium to entrants without any score', () => {
        expect(podiumRank({ rank: 1, points: 0, tops: 0, zones: 0 })).toBe(0)
    })
})
