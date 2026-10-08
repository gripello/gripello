import {
    clampCrop,
    cropRect,
    initialCrop,
    MAX_CROP_ZOOM,
    panCrop,
} from '~/utils/imageCrop'

const landscape = { width: 2000, height: 1000 }
const square = { width: 300, height: 300 }

describe('image crop', () => {
    it('starts centred, covering the frame with the short side', () => {
        const rect = cropRect(initialCrop(landscape), square, landscape)

        expect(rect).toEqual({ x: 500, y: 0, width: 1000, height: 1000 })
    })

    it('keeps the frame inside the image while panning', () => {
        const panned = panCrop(
            initialCrop(landscape),
            10_000,
            50,
            square,
            landscape,
        )

        expect(cropRect(panned, square, landscape)).toEqual({
            x: 0,
            y: 0,
            width: 1000,
            height: 1000,
        })
    })

    it('zooms into the centre and limits the zoom', () => {
        const zoomed = clampCrop(
            { ...initialCrop(landscape), zoom: 2 },
            square,
            landscape,
        )
        expect(cropRect(zoomed, square, landscape)).toEqual({
            x: 750,
            y: 250,
            width: 500,
            height: 500,
        })
        expect(clampCrop({ ...zoomed, zoom: 99 }, square, landscape).zoom).toBe(
            MAX_CROP_ZOOM,
        )
        expect(
            clampCrop({ ...zoomed, zoom: 0.2 }, square, landscape).zoom,
        ).toBe(1)
    })

    it('keeps the requested aspect for a wide banner frame', () => {
        const rect = cropRect(
            initialCrop(landscape),
            { width: 900, height: 300 },
            landscape,
        )

        expect(rect.width / rect.height).toBeCloseTo(3)
        expect(rect.width).toBeLessThanOrEqual(landscape.width)
    })
})
