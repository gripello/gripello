import type { Map as MapLibreMap } from 'maplibre-gl'

// Dark mode repaints the light "liberty" style in muted tones close to the app's dark surfaces, so the map doesn't glare.
// The first matching rule colours a layer.
export const DARK_MAP_RULES: [layer: RegExp, value: string | number][] = [
    [/^background$/, '#1d2329'],
    [/^natural_earth$/, 0.15],
    [/^park/, '#1f2b27'],
    [/^landcover_wood$/, '#1d2925'],
    [/^landcover_(grass|wetland)$/, '#1e2a26'],
    [/^landuse_(pitch|track|cemetery)$/, '#222e29'],
    [/^landuse_residential$/, '#252a32'],
    [/^landuse_hospital$/, '#2a2832'],
    [/^landuse_school$/, '#262b33'],
    [/^landcover_ice$/, '#2a313b'],
    [/^landcover_sand$/, '#2d2c27'],
    [/^water$/, '#18222f'],
    [/^waterway/, '#1e2a38'],
    [/^aeroway_fill$/, '#262b33'],
    [/^aeroway/, '#363d48'],
    [/hatching$/, '#252a32'],
    [/rail/, '#363d48'],
    [/casing$/, '#1a1f25'],
    [/motorway|trunk_primary/, '#59616e'],
    [/secondary_tertiary|_link$/, '#4b525e'],
    [/path_pedestrian/, '#323944'],
    [/minor|street|service_track/, '#3c434f'],
    [/^building$/, '#2a3038'],
    [/^building-3d$/, '#30363f'],
    [/^boundary/, '#464d5a'],
]

const COLOR_PROPERTY: Record<string, string> = {
    background: 'background-color',
    fill: 'fill-color',
    line: 'line-color',
    'fill-extrusion': 'fill-extrusion-color',
    raster: 'raster-opacity',
}

const TOWN_CLASSES = ['residential', 'commercial', 'industrial', 'retail']

type TintableMap = Pick<
    MapLibreMap,
    | 'getLayer'
    | 'getStyle'
    | 'setPaintProperty'
    | 'setLayerZoomRange'
    | 'setFilter'
>

export function darkPaint(layer: { id: string; type: string }) {
    if (layer.type === 'symbol')
        return [
            [
                'text-color',
                /water/.test(layer.id)
                    ? '#7286a6'
                    : layer.id === 'poi_transit'
                      ? '#8199c2'
                      : '#9aa2af',
            ],
            ['text-halo-color', '#14181d'],
        ] as const
    const property = COLOR_PROPERTY[layer.type]
    const rule = DARK_MAP_RULES.find(([pattern]) => pattern.test(layer.id))
    return property && rule ? ([[property, rule[1]]] as const) : []
}

export function tintDarkMap(map: TintableMap) {
    if (map.getLayer('landuse_residential')) {
        map.setLayerZoomRange('landuse_residential', 0, 24)
        map.setFilter('landuse_residential', [
            'match',
            ['get', 'class'],
            TOWN_CLASSES,
            true,
            false,
        ])
    }
    for (const layer of map.getStyle().layers)
        for (const [property, value] of darkPaint(layer))
            map.setPaintProperty(
                layer.id,
                property as Parameters<TintableMap['setPaintProperty']>[1],
                value,
            )
}
