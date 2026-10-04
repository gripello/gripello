import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
    formatAnchorPoint,
    formatScore,
    normalizeCreators,
    formatDateToYYYYMMDD,
    formatDate,
    localDateYYYYMMDD,
} from '#shared/utils/formatting'

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
    it('formats a finite number to two decimal places', () => {
        expect(formatScore({ score: 4.5 })).toBe('4.50/5')
    })

    it('uses the locale decimal separator', () => {
        expect(formatScore({ score: 4.5 }, 'de')).toBe('4,50/5')
    })

    it('formats an integer score', () => {
        expect(formatScore({ score: 3 })).toBe('3.00/5')
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

describe('formatDateToYYYYMMDD', () => {
    it('returns "" for null', () => {
        expect(formatDateToYYYYMMDD(null)).toBe('')
    })

    it('returns "" for undefined', () => {
        expect(formatDateToYYYYMMDD(undefined)).toBe('')
    })

    it('returns "" for empty string', () => {
        expect(formatDateToYYYYMMDD('')).toBe('')
    })

    it('returns "" for an invalid date string', () => {
        expect(formatDateToYYYYMMDD('not-a-date')).toBe('')
    })

    it('formats a full ISO datetime string to YYYY-MM-DD', () => {
        // Use a date-only part to avoid timezone shifts in the test runner.
        const result = formatDateToYYYYMMDD('2024-06-15')
        // Result must be YYYY-MM-DD shaped and contain the correct year and month.
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(result.startsWith('2024')).toBe(true)
    })

    it('zero-pads single-digit month and day', () => {
        const result = formatDateToYYYYMMDD('2024-01-05')
        expect(result).toMatch(/^\d{4}-01-\d{2}$/)
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

    it('keeps the stored PocketBase day when editing', () => {
        expect(formatDateToYYYYMMDD('2024-06-15 00:00:00.000Z')).toBe(
            '2024-06-15',
        )
        expect(
            formatDateToYYYYMMDD(
                formatDateToYYYYMMDD('2024-06-15 00:00:00.000Z'),
            ),
        ).toBe('2024-06-15')
    })

    it('displays a date-only value on its own day', () => {
        expect(
            formatDate('2024-06-15 00:00:00.000Z', {
                locale: 'en-US',
                dateStyle: 'medium',
            }),
        ).toBe('Jun 15, 2024')
    })

    it('still shows timestamps in local time', () => {
        expect(
            formatDate('2024-06-15 02:00:00.000Z', {
                locale: 'en-US',
                dateStyle: 'medium',
            }),
        ).toBe('Jun 14, 2024')
    })
})

describe('formatDate', () => {
    it('returns fallback for empty or invalid input', () => {
        expect(formatDate(null)).toBe('')
        expect(formatDate('nope', { fallback: '—' })).toBe('—')
    })

    it('parses PocketBase space-separated dates', () => {
        expect(
            formatDate('2024-03-05 10:00:00.000Z', {
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
