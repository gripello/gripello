import { describe, it, expect } from 'vitest'
import {
    compositeOver,
    mixColors,
    parseColor,
    toHex,
} from '~/utils/chromeColor'

describe('parseColor', () => {
    it('reads hex with and without alpha', () => {
        expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
        expect(parseColor('#161b22')).toEqual([22, 27, 34, 1])
        expect(parseColor('#161b2280')![3]).toBeCloseTo(0.5, 1)
    })

    it('reads rgb and rgba', () => {
        expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1])
        expect(parseColor('rgba(221, 221, 221, 0.32)')).toEqual([
            221, 221, 221, 0.32,
        ])
    })

    it('rejects anything else', () => {
        expect(parseColor('teal')).toBeNull()
        expect(parseColor('face')).toBeNull()
        expect(parseColor('bad')).toBeNull()
        expect(parseColor(' #bad')).toEqual([187, 170, 221, 1])
    })
})

describe('mixColors', () => {
    it('interpolates between two colors', () => {
        expect(mixColors('#000000', '#ffffff', 0)).toBe('#000000')
        expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080')
        expect(mixColors('#000000', '#ffffff', 1)).toBe('#ffffff')
    })

    it('falls back to the target on unreadable input', () => {
        expect(mixColors('nope', '#123456', 0.3)).toBe('#123456')
    })
})

describe('compositeOver', () => {
    it('blends a translucent scrim onto a surface', () => {
        expect(compositeOver('#ffffff', 'rgba(0, 0, 0, 0.5)')).toBe('#808080')
        expect(compositeOver('#161b22', 'rgba(0, 0, 0, 0)')).toBe('#161b22')
    })
})

describe('toHex', () => {
    it('clamps channels', () => {
        expect(toHex([300, -5, 16, 1])).toBe('#ff0010')
    })
})
