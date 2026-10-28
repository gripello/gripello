import { toHex6 } from '#shared/utils/color'
import { describe, it, expect } from 'vitest'
import {
    FALLBACK_DOT_COLOR,
    gradientEndColor,
    readableTextOn,
    routeDotColor,
    shadeColor,
} from '~/utils/color'

describe('toHex6', () => {
    it('expands 3-digit hex', () => {
        expect(toHex6('#f00')).toBe('#FF0000')
        expect(toHex6('abc')).toBe('#AABBCC')
    })

    it('normalises case and keeps six digits', () => {
        expect(toHex6('#7c4dff')).toBe('#7C4DFF')
        expect(toHex6('7C4DFF')).toBe('#7C4DFF')
        expect(toHex6('  #26a69a  ')).toBe('#26A69A')
    })

    it('drops the alpha channel the color picker can append', () => {
        expect(toHex6('#7C4DFFFF')).toBe('#7C4DFF')
        expect(toHex6('#7c4dff80')).toBe('#7C4DFF')
    })

    it('treats anything unusable as no color', () => {
        expect(toHex6('')).toBe('')
        expect(toHex6(null)).toBe('')
        expect(toHex6(undefined)).toBe('')
        expect(toHex6('rebeccapurple')).toBe('')
        expect(toHex6('#12345g')).toBe('')
    })
})

describe('readableTextOn', () => {
    it('puts white on dark backgrounds', () => {
        expect(readableTextOn('#7C4DFF')).toBe('#FFFFFF')
        expect(readableTextOn('#000000')).toBe('#FFFFFF')
        expect(readableTextOn('#8D6E63')).toBe('#FFFFFF')
    })

    it('puts black on light backgrounds', () => {
        expect(readableTextOn('#FFFFFF')).toBe('#000000')
        expect(readableTextOn('#9CCC65')).toBe('#000000')
        expect(readableTextOn('#FFA726')).toBe('#000000')
    })

    it('defers to the theme when there is no color', () => {
        expect(readableTextOn('')).toBe('inherit')
        expect(readableTextOn(null)).toBe('inherit')
        expect(readableTextOn('not-a-color')).toBe('inherit')
    })

    it('meets the WCAG AA 4.5:1 ratio for every swatch in the palette', () => {
        const palette = [
            '#EF5350',
            '#EC407A',
            '#AB47BC',
            '#7C4DFF',
            '#5C6BC0',
            '#42A5F5',
            '#26A69A',
            '#66BB6A',
            '#9CCC65',
            '#FFA726',
            '#8D6E63',
            '#78909C',
        ]

        const luminance = (hex: string) => {
            const chan = (o: number) => {
                const c = parseInt(hex.slice(o, o + 2), 16) / 255
                return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
            }
            return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5)
        }

        for (const hex of palette) {
            const bg = luminance(hex)
            const fg = readableTextOn(hex) === '#FFFFFF' ? 1 : 0
            const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)
            expect(ratio, `${hex} contrast`).toBeGreaterThanOrEqual(4.5)
        }
    })
})

describe('shadeColor', () => {
    it('shifts every channel and clamps to the valid range', () => {
        expect(shadeColor('#6200EA', -30)).toBe('#4400cc')
        expect(shadeColor('#FFFFFF', 30)).toBe('#ffffff')
        expect(shadeColor('#000', -30)).toBe('#000000')
    })

    it('returns unparseable input unchanged', () => {
        expect(shadeColor('red', -30)).toBe('red')
    })
})

describe('routeDotColor', () => {
    it('normalises valid colors and falls back to grey', () => {
        expect(routeDotColor('#e53935')).toBe('#E53935')
        expect(routeDotColor(null)).toBe(FALLBACK_DOT_COLOR)
        expect(routeDotColor('nope')).toBe(FALLBACK_DOT_COLOR)
    })
})

describe('gradientEndColor', () => {
    it('lightens near-black colours so the gradient stays visible', () => {
        expect(gradientEndColor('#000000')).toBe('#3c3c3c')
    })

    it('darkens every other colour', () => {
        expect(gradientEndColor('#ff8000')).toBe('#e16200')
    })
})
