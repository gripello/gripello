import { darkPaint, tintDarkMap } from '~/utils/mapStyle'

describe('darkPaint', () => {
    it('colours each layer by its kind', () => {
        expect(darkPaint({ id: 'water', type: 'fill' })).toEqual([
            ['fill-color', '#1e2a6a'],
        ])
        expect(darkPaint({ id: 'road_motorway_casing', type: 'line' })).toEqual(
            [['line-color', '#2a2f3e']],
        )
        expect(darkPaint({ id: 'road_motorway', type: 'line' })).toEqual([
            ['line-color', '#939cbe'],
        ])
        expect(
            darkPaint({ id: 'building-3d', type: 'fill-extrusion' }),
        ).toEqual([['fill-extrusion-color', '#454b63']])
        expect(darkPaint({ id: 'unknown', type: 'fill' })).toEqual([])
    })

    it('lightens labels and keeps water and transit apart', () => {
        expect(
            darkPaint({ id: 'highway-name-minor', type: 'symbol' })[0],
        ).toEqual(['text-color', '#c8cede'])
        expect(
            darkPaint({ id: 'water_name_line_label', type: 'symbol' })[0],
        ).toEqual(['text-color', '#8fa4e0'])
        expect(darkPaint({ id: 'poi_transit', type: 'symbol' })[0]).toEqual([
            'text-color',
            '#8fb4ff',
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
            '#1e2a6a',
        )
    })
})
