import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
    formatAnchorPoint,
    hasAnchorPoint,
    formatScore,
    normalizeCreators,
    formatDate,
    parseDate,
    localDateYYYYMMDD,
} from '#shared/utils/formatting'
import { formatNumber } from '#shared/utils/number'

describe('formatAnchorPoint', () => {
    it('returns "—" for null', () => {
        expect(formatAnchorPoint(null)).toBe('—')
    })

    it('returns "—" for undefined', () => {
        expect(formatAnchorPoint(undefined)).toBe('—')
    })

    it('returns "—" for empty string', () => {
        expect(formatAnchorPoint('')).toBe('—')
    })

    it('returns "-" for 0', () => {
        expect(formatAnchorPoint(0)).toBe('-')
    })

    it('returns "-" for the string "0"', () => {
        expect(formatAnchorPoint('0')).toBe('-')
    })

    it('passes through a positive number', () => {
        expect(formatAnchorPoint(12)).toBe(12)
    })

    it('passes through a non-empty string', () => {
        expect(formatAnchorPoint('A3')).toBe('A3')
    })
})

describe('formatScore', () => {
    it('formats a finite number to one decimal place', () => {
        expect(formatScore({ score: 4.5 })).toBe('4.5/5')
    })

    it('uses the locale decimal separator', () => {
        expect(formatScore({ score: 4.5 }, 'de')).toBe('4,5/5')
    })

    it('formats an integer score', () => {
        expect(formatScore({ score: 3 })).toBe('3.0/5')
    })

    it('returns "—" when score is null', () => {
        expect(formatScore({ score: null })).toBe('—')
    })

    it('returns "—" when score is undefined', () => {
        expect(formatScore({})).toBe('—')
    })

    it('returns "—" when score is NaN', () => {
        expect(formatScore({ score: NaN })).toBe('—')
    })

    it('returns "—" when score is Infinity', () => {
        expect(formatScore({ score: Infinity })).toBe('—')
    })

    it('returns "—" for a null route', () => {
        expect(formatScore(null)).toBe('—')
    })

    it('returns "—" for an undefined route', () => {
        expect(formatScore(undefined)).toBe('—')
    })
})

describe('normalizeCreators', () => {
    it('splits a comma-separated string into trimmed parts', () => {
        expect(normalizeCreators('Alice, Bob, Charlie')).toEqual([
            'Alice',
            'Bob',
            'Charlie',
        ])
    })

    it('filters out empty segments from a string', () => {
        expect(normalizeCreators(',Alice,,Bob,')).toEqual(['Alice', 'Bob'])
    })

    it('returns an array of trimmed strings when input is an array', () => {
        expect(normalizeCreators(['  Alice  ', 'Bob'])).toEqual([
            'Alice',
            'Bob',
        ])
    })

    it('filters out non-string values from an array', () => {
        expect(
            normalizeCreators(['Alice', 42, null, 'Bob'] as unknown[]),
        ).toEqual(['Alice', 'Bob'])
    })

    it('returns [] for an empty string', () => {
        expect(normalizeCreators('')).toEqual([])
    })

    it('returns [] for an empty array', () => {
        expect(normalizeCreators([])).toEqual([])
    })

    it('returns [] for null', () => {
        expect(normalizeCreators(null)).toEqual([])
    })

    it('returns [] for undefined', () => {
        expect(normalizeCreators(undefined)).toEqual([])
    })

    it('returns [] for a number', () => {
        expect(normalizeCreators(42)).toEqual([])
    })
})

describe('dates west of UTC', () => {
    const originalTimeZone = process.env.TZ
    beforeEach(() => {
        process.env.TZ = 'America/New_York'
    })
    afterEach(() => {
        process.env.TZ = originalTimeZone
    })

    it('displays a calendar day on its own day', () => {
        expect(
            formatDate('2024-06-15', { locale: 'en-US', dateStyle: 'medium' }),
        ).toBe('Jun 15, 2024')
        expect(parseDate('2024-06-15')?.getDate()).toBe(15)
    })

    it('shows timestamps in local time, also at UTC midnight', () => {
        expect(
            formatDate('2024-06-15T02:00:00.000Z', {
                locale: 'en-US',
                dateStyle: 'medium',
            }),
        ).toBe('Jun 14, 2024')
        expect(
            formatDate('2024-06-15T00:00:00.000Z', {
                locale: 'en-US',
                dateStyle: 'medium',
            }),
        ).toBe('Jun 14, 2024')
    })
})

describe('parseDate', () => {
    it('reads RFC 3339 timestamps', () => {
        expect(parseDate('2026-10-20T10:36:12.123Z')?.toISOString()).toBe(
            '2026-10-20T10:36:12.123Z',
        )
    })

    it('returns null for empty or invalid input', () => {
        expect(parseDate('')).toBeNull()
        expect(parseDate('not-a-date')).toBeNull()
    })
})

describe('formatDate', () => {
    it('returns fallback for empty or invalid input', () => {
        expect(formatDate(null)).toBe('')
        expect(formatDate('nope', { fallback: '—' })).toBe('—')
    })

    it('parses RFC 3339 timestamps', () => {
        expect(
            formatDate('2024-03-05T10:00:00.000Z', {
                locale: 'en-US',
                timeZone: 'UTC',
            }),
        ).toBe('3/5/2024')
    })

    it('forwards Intl options and switches to date-time', () => {
        expect(
            formatDate('2024-03-05T10:00:00Z', {
                locale: 'en-US',
                timeZone: 'UTC',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
            }),
        ).toBe('March 5, 2024')
        expect(
            formatDate('2024-03-05T10:00:00Z', {
                locale: 'en-US',
                timeZone: 'UTC',
                withTime: true,
            }),
        ).toContain('10:00')
    })
})

describe('localDateYYYYMMDD', () => {
    it('uses the local calendar day, not the UTC one', () => {
        expect(localDateYYYYMMDD(new Date(2026, 9, 4, 23, 30))).toBe(
            '2026-10-04',
        )
        expect(localDateYYYYMMDD(new Date(2026, 0, 2, 0, 15))).toBe(
            '2026-01-02',
        )
    })
})

describe('hasAnchorPoint', () => {
    it.each([
        [null, false],
        ['', false],
        [0, false],
        ['0', false],
        [12, true],
        ['A3', true],
    ])('%s → %s', (value, expected) => {
        expect(hasAnchorPoint(value)).toBe(expected)
    })
})

describe.each([
    ['en', '3.5', '0.0'],
    ['de', '3,5', '0,0'],
    ['nl', '3,5', '0,0'],
    ['fr', '3,5', '0,0'],
    ['es', '3,5', '0,0'],
])('numbers in %s', (locale, half, zero) => {
    it('uses the locale decimal separator', () => {
        expect(formatNumber(3.5, locale)).toBe(half)
        expect(formatNumber(0, locale)).toBe(zero)
        expect(formatScore({ score: 3.5 }, locale)).toBe(`${half}/5`)
        expect(formatScore({ score: 0 }, locale)).toBe(`${zero}/5`)
    })

    it('shows a dash for missing values', () => {
        for (const missing of [NaN, null, undefined, Infinity]) {
            expect(formatNumber(missing, locale)).toBe('—')
        }
        expect(formatScore({ score: NaN }, locale)).toBe('—')
    })
})
