import {
    clampZoom,
    MAX_IMAGE_ZOOM,
    pinchZoom,
    toggleZoom,
    UNZOOMED,
    zoomAround,
} from '~/utils/imageZoom'

const size = { width: 400, height: 300 }

describe('imageZoom', () => {
    it('zooms faster than the fingers spread, around their midpoint', () => {
        const zoom = pinchZoom(
            UNZOOMED,
            [
                { x: 150, y: 150 },
                { x: 250, y: 150 },
            ],
            [
                { x: 100, y: 150 },
                { x: 300, y: 150 },
            ],
            size,
        )
        const scale = 2 ** 1.5
        expect(zoom.scale).toBeCloseTo(scale)
        expect(zoom.x).toBeCloseTo(200 - 200 * scale)
        expect(zoom.y).toBeCloseTo(150 - 150 * scale)
    })

    it('pans with the midpoint of a two-finger drag', () => {
        const start = { scale: 2, x: -200, y: -150 }
        const zoom = pinchZoom(
            start,
            [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
            ],
            [
                { x: 120, y: 110 },
                { x: 220, y: 110 },
            ],
            size,
        )
        expect(zoom).toEqual({ scale: 2, x: -180, y: -140 })
    })

    it('never zooms out past the fitted image or beyond the maximum', () => {
        expect(zoomAround(UNZOOMED, { x: 50, y: 50 }, 0.5, size)).toEqual(
            UNZOOMED,
        )
        expect(zoomAround(UNZOOMED, { x: 0, y: 0 }, 100, size).scale).toBe(
            MAX_IMAGE_ZOOM,
        )
    })

    it('keeps the zoomed image covering the frame', () => {
        expect(clampZoom({ scale: 2, x: 50, y: -1000 }, size)).toEqual({
            scale: 2,
            x: 0,
            y: -300,
        })
    })

    it('double tap zooms in at the tap and back out', () => {
        const zoomed = toggleZoom(UNZOOMED, { x: 200, y: 150 }, size)
        expect(zoomed.scale).toBe(3)
        expect(zoomed.x).toBe(200 - 200 * 3)
        expect(toggleZoom(zoomed, { x: 0, y: 0 }, size)).toEqual(UNZOOMED)
    })
})
