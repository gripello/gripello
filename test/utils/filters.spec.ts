import { describe, it, expect } from 'vitest'

interface Comment {
    difficulty: number | null
    location: string | null
    routeName: string
    comment: string
    userName: string
}

function filteredComments(
    comments: Comment[],
    selectedDifficulty: number | null,
    selectedLocation: string | null,
    search: string,
): Comment[] {
    return comments.filter((comment) => {
        const difficultyMatch =
            !selectedDifficulty || comment.difficulty === selectedDifficulty
        const locationMatch =
            !selectedLocation || comment.location === selectedLocation
        const term = search?.toLowerCase() ?? ''
        const searchMatch =
            !term ||
            comment.routeName?.toLowerCase().includes(term) ||
            comment.comment?.toLowerCase().includes(term) ||
            comment.userName?.toLowerCase().includes(term)
        return difficultyMatch && locationMatch && searchMatch
    })
}

const sampleComments: Comment[] = [
    {
        difficulty: 5,
        location: 'loc-main',
        routeName: 'Blue Wave',
        comment: 'Great route!',
        userName: 'Alice',
    },
    {
        difficulty: 7,
        location: 'loc-other',
        routeName: 'Red Wall',
        comment: 'Very hard',
        userName: 'Bob',
    },
    {
        difficulty: 5,
        location: 'loc-other',
        routeName: 'Green Path',
        comment: 'Fun climb',
        userName: 'Carol',
    },
]

describe('filteredComments', () => {
    it('returns all comments when no filter is active', () => {
        expect(filteredComments(sampleComments, null, null, '')).toHaveLength(3)
    })

    it('filters by difficulty', () => {
        const result = filteredComments(sampleComments, 5, null, '')
        expect(result).toHaveLength(2)
        expect(result.every((c) => c.difficulty === 5)).toBe(true)
    })

    it('filters by location', () => {
        const result = filteredComments(sampleComments, null, 'loc-main', '')
        expect(result).toHaveLength(1)
        expect(result[0].routeName).toBe('Blue Wave')
    })

    it('combines difficulty and location filters', () => {
        const result = filteredComments(sampleComments, 5, 'loc-other', '')
        expect(result).toHaveLength(1)
        expect(result[0].routeName).toBe('Green Path')
    })

    it('matches search term against routeName (case-insensitive)', () => {
        const result = filteredComments(sampleComments, null, null, 'blue')
        expect(result).toHaveLength(1)
        expect(result[0].routeName).toBe('Blue Wave')
    })

    it('matches search term against comment text', () => {
        const result = filteredComments(sampleComments, null, null, 'great')
        expect(result).toHaveLength(1)
        expect(result[0].userName).toBe('Alice')
    })

    it('matches search term against userName', () => {
        const result = filteredComments(sampleComments, null, null, 'bob')
        expect(result).toHaveLength(1)
        expect(result[0].routeName).toBe('Red Wall')
    })

    it('returns empty array when nothing matches', () => {
        expect(
            filteredComments(sampleComments, null, null, 'xyz-no-match'),
        ).toHaveLength(0)
    })
})

function formatDate(date: string | null | undefined): string | null {
    if (!date) return null
    return new Date(date).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })
}

describe('formatDate (comments page)', () => {
    it('returns null for null input', () => {
        expect(formatDate(null)).toBeNull()
    })

    it('returns null for undefined input', () => {
        expect(formatDate(undefined)).toBeNull()
    })

    it('returns null for empty string', () => {
        expect(formatDate('')).toBeNull()
    })

    it('returns a non-empty string for a valid ISO date', () => {
        const result = formatDate('2024-06-15T12:00:00Z')
        expect(typeof result).toBe('string')
        expect(result!.length).toBeGreaterThan(0)
    })
})
