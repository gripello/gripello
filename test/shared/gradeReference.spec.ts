import { describe, it, expect } from 'vitest'
import { gradeLabels } from '#shared/utils/grades'
import {
    DEFAULT_GYM_BANDS,
    V_FONT_SPANS,
    bandRanges,
    moveBandBoundary,
    splitBand,
    bandSettingsFrom,
    gymBandsFrom,
    gymBandFor,
} from '#shared/utils/gradeReference'

describe('grade reference ladders', () => {
    const fontCount = gradeLabels('font').length

    it('spans V grades and gym bands over every Fb column', () => {
        const sum = (spans: number[]) => spans.reduce((a, b) => a + b, 0)
        expect(sum(V_FONT_SPANS)).toBe(fontCount)
        expect(sum(DEFAULT_GYM_BANDS.map((band) => band.span))).toBe(fontCount)
    })

    it('derives the legend from the bands', () => {
        expect(
            bandRanges(DEFAULT_GYM_BANDS).map(({ key, font, uiaa }) => [
                key,
                font,
                uiaa,
            ]),
        ).toEqual([
            ['yellow', ['<2', '4+'], ['5+', '6+']],
            ['orange', ['5', '5+'], ['7-', '7']],
            ['blue', ['6A', '6B'], ['7+', '8']],
            ['red', ['6B+', '6C+'], ['8+', '9']],
            ['black', ['7A', '8C+'], ['9+', '12']],
        ])
    })
})

describe('gymBandFor', () => {
    const band = (grade: string, grade_system: string) =>
        gymBandFor({ grade, grade_system })?.key ?? null

    it('maps boulder grades to their band', () => {
        expect(band('<2', 'font')).toBe('yellow')
        expect(band('4+', 'font')).toBe('yellow')
        expect(band('5', 'font')).toBe('orange')
        expect(band('6b', 'font')).toBe('blue')
        expect(band('6C+', 'font')).toBe('red')
        expect(band('8C+', 'font')).toBe('black')
        expect(band('V4', 'v')).toBe('blue')
        expect(band('V6', 'v')).toBe('black')
    })

    it('ignores routes and unknown grades', () => {
        expect(band('7', 'uiaa')).toBeNull()
        expect(band('9Z', 'font')).toBeNull()
        expect(gymBandFor(null)).toBeNull()
    })
})

describe('gym band settings', () => {
    it('turns "up to" grades into spans and lets the last band run to the top', () => {
        const bands = gymBandsFrom([
            { name: 'White', color: '#ffffff', to: '5+' },
            { name: 'Pink', color: '#ff00ff', to: '6C+' },
            { name: 'Black', color: '#000000', to: '' },
        ])
        expect(bands.map(({ name, span }) => [name, span])).toEqual([
            ['White', 6],
            ['Pink', 6],
            ['Black', 12],
        ])
        expect(
            gymBandFor({ grade: '6A', grade_system: 'font' }, bands)?.name,
        ).toBe('Pink')
    })

    it('skips bands that end before the previous one and falls back to defaults', () => {
        expect(
            gymBandsFrom([
                { name: 'A', color: '#111111', to: '6A' },
                { name: 'B', color: '#222222', to: '5' },
                { name: 'C', color: '#333333', to: '' },
            ]).map((band) => band.name),
        ).toEqual(['A', 'C'])
        expect(gymBandsFrom(null)).toBe(DEFAULT_GYM_BANDS)
        expect(gymBandsFrom([])).toBe(DEFAULT_GYM_BANDS)
    })

    it('round-trips the default bands', () => {
        const settings = bandSettingsFrom(DEFAULT_GYM_BANDS, (band) => band.key)
        expect(settings[0]).toEqual({
            name: 'yellow',
            color: '#facc15',
            to: '4+',
        })
        expect(gymBandsFrom(settings).map((band) => band.span)).toEqual(
            DEFAULT_GYM_BANDS.map((band) => band.span),
        )
    })
})

describe('band editor', () => {
    const three = [
        { name: 'A', color: '#111111', to: '4+' },
        { name: 'B', color: '#222222', to: '6B' },
        { name: 'C', color: '#333333', to: '8C+' },
    ]
    const limits = (settings: typeof three) => settings.map((band) => band.to)

    it('moves a boundary but keeps every band at least one grade wide', () => {
        expect(limits(moveBandBoundary(three, 0, 5))).toEqual([
            '5+',
            '6B',
            '8C+',
        ])
        expect(limits(moveBandBoundary(three, 0, 99))).toEqual([
            '6A+',
            '6B',
            '8C+',
        ])
        expect(limits(moveBandBoundary(three, 1, -5))).toEqual([
            '4+',
            '5',
            '8C+',
        ])
        expect(limits(moveBandBoundary(three, 1, 99))).toEqual([
            '4+',
            '8C',
            '8C+',
        ])
    })

    it('splits a band in the middle and ignores single-grade bands', () => {
        const split = splitBand(three, 1)
        expect(limits(split)).toEqual(['4+', '5+', '6B', '8C+'])
        expect(split[2]).toMatchObject({ name: '', to: '6B' })
        const single = [
            { name: 'A', color: '#111111', to: '<2' },
            { name: 'B', color: '#222222', to: '' },
        ]
        expect(splitBand(single, 0)).toBe(single)
    })
})

describe('gymBandsFrom with broken settings', () => {
    it('falls back to the default bands when the stored value is not a list', () => {
        expect(gymBandsFrom('abc' as never)).toEqual(DEFAULT_GYM_BANDS)
        expect(gymBandsFrom({} as never)).toEqual(DEFAULT_GYM_BANDS)
    })
})
