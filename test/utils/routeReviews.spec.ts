import { describe, expect, it } from 'vitest'
import {
    averageRating,
    commonDifficulty,
    reviewDisplay,
} from '~/utils/routeReviews'
import type { RatingRecord } from '~/types/models'

const review = (rating: number | null, grade = '') =>
    reviewDisplay(
        {
            id: 'r',
            rating,
            grade,
            grade_system: grade ? 'french' : '',
        } as unknown as RatingRecord,
        'Anonymous',
    )

describe('route reviews', () => {
    it('names authorless reviews and keeps unrated ones unrated', () => {
        const shown = review(null)
        expect(shown.userName).toBe('Anonymous')
        expect(shown.rating).toBeNull()
        expect(shown.mine).toBe(false)
    })

    it('averages only rated reviews', () => {
        expect(averageRating([review(4), review(2), review(0)])).toBe(3)
        expect(averageRating([review(null)])).toBeNull()
    })

    it('picks the most voted difficulty', () => {
        expect(
            commonDifficulty([
                review(1, '6a'),
                review(1, '6b'),
                review(1, '6b'),
            ]),
        ).toBe(review(1, '6b').difficultyLabel)
        expect(commonDifficulty([review(1)])).toBeNull()
    })
})
