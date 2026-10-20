export const PERCEIVED_GRADE_ICON = 'i-lucide-users-round'

import { formatGrade } from '#shared/utils/grades'
import type { RatingRecord } from '~/types/models'

export interface ReviewDisplay {
    id: string
    rating: number | null
    difficultyLabel: string
    comment: string | null
    created: string
    userName: string
    userAvatar: string | null
    userId?: string
    mine: boolean
}

export function reviewDisplay(
    rating: RatingRecord,
    anonymousName: string,
): ReviewDisplay {
    return {
        id: rating.id,
        rating: typeof rating.rating === 'number' ? rating.rating : null,
        difficultyLabel: formatGrade(rating),
        comment: rating.comment ?? null,
        created: rating.created ?? '',
        userName: rating.author?.name || anonymousName,
        userAvatar: rating.author?.avatar || null,
        userId: rating.author?.id,
        mine: !!rating.mine,
    }
}

export function averageRating(reviews: ReviewDisplay[]): number | null {
    const rated = reviews.filter((review) => (review.rating ?? 0) > 0)
    if (!rated.length) return null
    return (
        rated.reduce((sum, review) => sum + (review.rating ?? 0), 0) /
        rated.length
    )
}

export function commonDifficulty(reviews: ReviewDisplay[]): string | null {
    const counts = new Map<string, number>()
    for (const { difficultyLabel } of reviews)
        if (difficultyLabel)
            counts.set(difficultyLabel, (counts.get(difficultyLabel) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
