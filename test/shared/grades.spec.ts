import { describe, it, expect } from 'vitest'
import {
    GRADE_SYSTEMS,
    GRADE_TABLES,
    canonicalGrade,
    formatGrade,
    gradeKey,
    compareGradeKeys,
    gradeIndex,
    gradeLabels,
    gradesAround,
    nearestGrade,
    resolveImportedGrading,
} from '#shared/utils/grades'

describe('grade tables', () => {
    it.each(GRADE_SYSTEMS)('%s is strictly ascending and unique', (system) => {
        const indexes = GRADE_TABLES[system].map(([, index]) => index)
        const sorted = [...indexes].sort((a, b) => a - b)
        expect(indexes).toEqual(sorted)
        expect(new Set(indexes).size).toBe(indexes.length)
        expect(new Set(gradeLabels(system)).size).toBe(indexes.length)
    })

    it('covers every IRCRA level of the chart', () => {
        expect(GRADE_TABLES.french.map(([, index]) => index)).toEqual(
            Array.from({ length: 32 }, (_, i) => i + 1),
        )
        expect(gradeIndex('yds', '5.15c')).toBe(32)
        expect(gradeIndex('uiaa', '12')).toBe(32.1)
        expect(gradeIndex('v', 'V16')).toBe(31.9)
        expect(gradeIndex('font', '8C+')).toBe(31.9)
    })

    it('aligns common equivalents across scales', () => {
        expect(gradeIndex('french', '6a')).toBe(gradeIndex('yds', '5.10b'))
        expect(gradeIndex('french', '7a')).toBe(gradeIndex('yds', '5.11d'))
        expect(nearestGrade('french', gradeIndex('uiaa', '7')!)).toBe('6b')
        expect(nearestGrade('v', gradeIndex('font', '7A')!)).toBe('V6')
    })
})

describe('gradeIndex', () => {
    it('matches case and whitespace insensitively', () => {
        expect(gradeIndex('french', ' 6A+ ')).toBe(12)
        expect(gradeIndex('font', '7a')).toBe(20.3)
    })

    it('returns null for unknown systems or grades', () => {
        expect(gradeIndex('ewbank', '20')).toBeNull()
        expect(gradeIndex('uiaa', '6a')).toBeNull()
        expect(gradeIndex('uiaa', null)).toBeNull()
    })
})

describe('nearestGrade', () => {
    it('picks the closest label on the target scale', () => {
        expect(nearestGrade('font', 16.2)).toBe('6A+')
        expect(nearestGrade('v', 20)).toBe('V6')
    })
})

describe('canonicalGrade', () => {
    it('returns the table spelling', () => {
        expect(canonicalGrade('font', '6a+')).toBe('6A+')
        expect(canonicalGrade('v', 'v5')).toBe('V5')
        expect(canonicalGrade('uiaa', '6a')).toBeNull()
    })
})

describe('gradeKey', () => {
    it('adds the scale only when asked', () => {
        const font = { grade: '5', grade_system: 'font' }
        expect(gradeKey(font, false)).toBe('5')
        expect(gradeKey(font, true)).toBe('5 · Font')
        expect(gradeKey({ grade: '' }, true)).toBe('?')
    })

    it('orders keys by the scale they name', () => {
        expect(compareGradeKeys('5 · Font', '6 · UIAA')).toBeGreaterThan(0)
        expect(compareGradeKeys('5 · UIAA', '6 · UIAA')).toBeLessThan(0)
        expect(compareGradeKeys('?', '12 · UIAA')).toBeGreaterThan(0)
    })

    it.each(GRADE_SYSTEMS)(
        'orders every %s label by that scale without a suffix',
        (system) => {
            const labels = gradeLabels(system)
            expect([...labels].reverse().sort(compareGradeKeys)).toEqual(labels)
        },
    )

    it('tells Font 6A and French 6a apart by case', () => {
        expect(compareGradeKeys('6A', '6B')).toBeLessThan(0)
        expect(compareGradeKeys('6a', '5+')).toBeGreaterThan(0)
        expect(compareGradeKeys('6A', '<2')).toBeGreaterThan(0)
    })

    it('orders non-canonical stored grades like their canonical label', () => {
        expect(compareGradeKeys('6A · Fr', '5+ · Fr')).toBeGreaterThan(0)
        expect(compareGradeKeys('6A · Fr', '6b · Fr')).toBeLessThan(0)
        expect(compareGradeKeys('v3', 'V4')).toBeLessThan(0)
        expect(compareGradeKeys('6a +', '6b')).toBeLessThan(0)
        expect(compareGradeKeys('6a +', '6a')).toBeGreaterThan(0)
        expect(compareGradeKeys('v3', '?')).toBeLessThan(0)
    })
})

describe('formatGrade', () => {
    it('returns the stored label', () => {
        expect(formatGrade({ grade: ' 6a+ ' })).toBe('6a+')
        expect(formatGrade(null)).toBe('')
    })

    it('spells known grades the way their system writes them', () => {
        expect(formatGrade({ grade: '6b', grade_system: 'font' })).toBe('6B')
        expect(formatGrade({ grade: '6B+', grade_system: 'french' })).toBe(
            '6b+',
        )
        expect(formatGrade({ grade: 'v5', grade_system: 'v' })).toBe('V5')
        expect(formatGrade({ grade: 'odd', grade_system: 'font' })).toBe('odd')
    })
})

describe('resolveImportedGrading', () => {
    it('stores the canonical label for new-format grades', () => {
        expect(
            resolveImportedGrading(
                { grade: '6A', grade_system: 'french' },
                'uiaa',
            ),
        ).toEqual({ grade: '6a', grade_system: 'french', grade_index: 11 })
    })

    it('keeps valid new-format grades', () => {
        expect(
            resolveImportedGrading(
                { grade: '5.11a', grade_system: 'yds' },
                'french',
            ),
        ).toEqual({ grade: '5.11a', grade_system: 'yds', grade_index: 14 })
    })

    it('reads legacy UIAA routes as UIAA', () => {
        expect(
            resolveImportedGrading(
                { difficulty: 7, difficulty_sign: true },
                'french',
            ),
        ).toEqual({ grade: '7+', grade_system: 'uiaa', grade_index: 14.6 })
    })

    it('converts legacy UIAA boulders to the boulder scale', () => {
        expect(
            resolveImportedGrading(
                { difficulty: 8, difficulty_sign: null },
                'font',
            ),
        ).toEqual({ grade: '6B', grade_system: 'font', grade_index: 17.1 })
    })

    it('maps legacy UIAA grades missing from the chart to the nearest one', () => {
        expect(
            resolveImportedGrading(
                { difficulty: 2, difficulty_sign: true },
                'uiaa',
            ),
        ).toEqual({ grade: '2', grade_system: 'uiaa', grade_index: 1.9 })
    })

    it('returns an empty grade when nothing matches', () => {
        expect(resolveImportedGrading({}, 'uiaa')).toEqual({
            grade: '',
            grade_system: 'uiaa',
            grade_index: null,
        })
    })
})

describe('gradesAround', () => {
    it('offers two grades below and above the route grade', () => {
        expect(gradesAround('uiaa', '5', 2)).toEqual([
            '4+',
            '5-',
            '5',
            '5+',
            '6-',
        ])
    })

    it('clamps at the ends of the scale', () => {
        expect(gradesAround('uiaa', '1', 2)).toEqual(['1', '2', '3'])
    })

    it('falls back to every grade when the route grade is unknown', () => {
        expect(gradesAround('uiaa', null, 2)).toEqual(gradeLabels('uiaa'))
    })
})
