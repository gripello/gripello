import { describe, expect, it } from 'vitest'
import { paletteFromPixels, paletteGradient } from '~/utils/palette'

const pixels = (...colors: [number, number, number, number][]) =>
    colors.flatMap(([r, g, b, times]) =>
        Array.from({ length: times }, () => [r, g, b, 255]).flat(),
    )

describe('paletteFromPixels', () => {
    it('prefers saturated colours over a large grey background', () => {
        const palette = paletteFromPixels(
            pixels([235, 235, 235, 60], [30, 90, 200, 25], [220, 120, 70, 15]),
        )
        expect(palette[0]).toBe('#1e5ac8')
        expect(palette).toContain('#dc7846')
        expect(palette).toHaveLength(3)
    })

    it('skips near-identical colours and transparent pixels', () => {
        expect(
            paletteFromPixels([
                ...pixels([200, 40, 40, 10], [205, 45, 42, 10]),
                0,
                0,
                0,
                0,
            ]),
        ).toHaveLength(1)
    })
})

describe('paletteGradient', () => {
    it('builds a gradient from one or more colours', () => {
        expect(paletteGradient([])).toBeNull()
        expect(paletteGradient(['#111111'])).toBe(
            'linear-gradient(120deg, #111111, #111111)',
        )
        expect(paletteGradient(['#111111', '#222222'])).toBe(
            'linear-gradient(120deg, #111111, #222222)',
        )
    })
})
