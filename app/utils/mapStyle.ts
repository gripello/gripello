import type { Map as MapLibreMap } from 'maplibre-gl'

// Dark mode repaints the light "liberty" style (3D buildings, transit, street names) in Apple's dark palette:
// teal land, slate towns, navy water, blue-grey roads. The first matching rule colours a layer.
export const DARK_MAP_RULES: [layer: RegExp, value: string | number][] = [
    [/^background$/, '#124b4a'],
    [/^natural_earth$/, 0.15],
    [/^park/, '#2a604a'],
    [/^landcover_wood$/, '#1d5a4b'],
    [/^landcover_(grass|wetland)$/, '#1a5a4f'],
    [/^landuse_(pitch|track|cemetery)$/, '#24584a'],
    [/^landuse_residential$/, '#353b4f'],
    [/^landuse_hospital$/, '#463d57'],
    [/^landuse_school$/, '#3a4054'],
    [/^landcover_ice$/, '#3b4a5c'],
    [/^landcover_sand$/, '#4a4838'],
    [/^water$/, '#1e2a6a'],
    [/^waterway/, '#2b3c8c'],
    [/^aeroway_fill$/, '#2f3546'],
    [/^aeroway/, '#4b5370'],
    [/hatching$/, '#353b4f'],
    [/rail/, '#4b5370'],
    [/casing$/, '#2a2f3e'],
    [/motorway|trunk_primary/, '#939cbe'],
    [/secondary_tertiary|_link$/, '#7c84a6'],
    [/path_pedestrian/, '#4c5470'],
    [/minor|street|service_track/, '#5c6482'],
    [/^building$/, '#3d4357'],
    [/^building-3d$/, '#454b63'],
    [/^boundary/, '#5a6080'],
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
                    ? '#8fa4e0'
                    : layer.id === 'poi_transit'
                      ? '#8fb4ff'
                      : '#c8cede',
            ],
            ['text-halo-color', '#1a2030'],
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
