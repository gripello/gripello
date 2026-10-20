import { describe, expect, it } from 'vitest'
import { normalizeHexColor, parseHexColor, toHex6 } from '#shared/utils/color'

describe('normalizeHexColor', () => {
    it('drops the alpha channel of 8-digit hex colours', () => {
        expect(normalizeHexColor('#DA5307F6')).toBe('#DA5307')
    })

    it('uppercases and adds the hash to 6-digit colours', () => {
        expect(normalizeHexColor('da5307')).toBe('#DA5307')
    })

    it('expands 3-digit colours', () => {
        expect(normalizeHexColor('#f80')).toBe('#FF8800')
    })

    it('falls back to grey for anything else', () => {
        expect(normalizeHexColor('')).toBe('#9E9E9E')
        expect(normalizeHexColor(null)).toBe('#9E9E9E')
        expect(normalizeHexColor('red')).toBe('#9E9E9E')
        expect(normalizeHexColor('#12345')).toBe('#9E9E9E')
    })
})

describe('parseHexColor', () => {
    it('reads 3, 4, 6 and 8 digits with an optional hash', () => {
        expect(parseHexColor('#fff')).toEqual([255, 255, 255, 1])
        expect(parseHexColor('0008')![3]).toBeCloseTo(0.53, 2)
        expect(parseHexColor(' #161b22 ')).toEqual([22, 27, 34, 1])
        expect(parseHexColor('#161b2280')![3]).toBeCloseTo(0.5, 1)
    })

    it('rejects other lengths and non-hex values', () => {
        expect(parseHexColor('#12345')).toBeNull()
        expect(parseHexColor('#1234567')).toBeNull()
        expect(parseHexColor('#12345g')).toBeNull()
        expect(parseHexColor('rgb(1, 2, 3)')).toBeNull()
        expect(parseHexColor(undefined)).toBeNull()
    })

    it('toHex6 drops alpha and uppercases', () => {
        expect(toHex6('#7c4dff80')).toBe('#7C4DFF')
        expect(toHex6('abc')).toBe('#AABBCC')
        expect(toHex6('nope')).toBe('')
    })
})
