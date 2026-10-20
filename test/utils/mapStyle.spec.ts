import { darkPaint, tintDarkMap, DARK_MAP_RULES } from '~/utils/mapStyle'

describe('darkPaint', () => {
    it('colours each layer by its kind', () => {
        expect(darkPaint({ id: 'water', type: 'fill' })).toEqual([
            ['fill-color', '#18222f'],
        ])
        expect(darkPaint({ id: 'road_motorway_casing', type: 'line' })).toEqual(
            [['line-color', '#1a1f25']],
        )
        expect(darkPaint({ id: 'road_motorway', type: 'line' })).toEqual([
            ['line-color', '#59616e'],
        ])
        expect(
            darkPaint({ id: 'building-3d', type: 'fill-extrusion' }),
        ).toEqual([['fill-extrusion-color', '#30363f']])
        expect(darkPaint({ id: 'unknown', type: 'fill' })).toEqual([])
    })

    it('lightens labels and keeps water and transit apart', () => {
        expect(
            darkPaint({ id: 'highway-name-minor', type: 'symbol' })[0],
        ).toEqual(['text-color', '#9aa2af'])
        expect(
            darkPaint({ id: 'water_name_line_label', type: 'symbol' })[0],
        ).toEqual(['text-color', '#7286a6'])
        expect(darkPaint({ id: 'poi_transit', type: 'symbol' })[0]).toEqual([
            'text-color',
            '#8199c2',
        ])
    })
})

describe('tintDarkMap', () => {
    it('shows towns at every zoom and repaints every layer', () => {
        const map = {
            getLayer: () => ({}),
            getStyle: () => ({ layers: [{ id: 'water', type: 'fill' }] }),
            setPaintProperty: vi.fn(),
            setLayerZoomRange: vi.fn(),
            setFilter: vi.fn(),
        }
        tintDarkMap(map as never)
        expect(map.setLayerZoomRange).toHaveBeenCalledWith(
            'landuse_residential',
            0,
            24,
        )
        expect(map.setPaintProperty).toHaveBeenCalledWith(
            'water',
            'fill-color',
            '#18222f',
        )
    })
})

describe('dark map palette', () => {
    const hsl = (hex: string) => {
        const [r, g, b] = [1, 3, 5].map(
            (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
        ) as [number, number, number]
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const lightness = (max + min) / 2
        const saturation =
            max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1))
        return { saturation, lightness }
    }

    it('stays muted and dark so the map does not glare next to the dark UI', () => {
        for (const [layer, value] of DARK_MAP_RULES) {
            if (typeof value !== 'string') continue
            const { saturation, lightness } = hsl(value)
            expect(lightness, String(layer)).toBeLessThanOrEqual(0.4)
            expect(saturation, String(layer)).toBeLessThanOrEqual(0.35)
        }
    })
})
