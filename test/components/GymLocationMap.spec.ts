import { readFileSync } from 'node:fs'

const source = readFileSync('app/components/gym/LocationMap.vue', 'utf8')

describe('GymLocationMap', () => {
    it('draws vector maps that follow the colour mode', () => {
        expect(source).toContain(
            "from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'",
        )
        expect(source).toContain('maplibre.setWorkerUrl(workerUrl)')
        expect(source).toContain('map?.setStyle(mapStyle, { diff: false })')
        expect(source).toContain(
            "map.addControl(recenterControl(), 'top-left')",
        )
        expect(source).toContain(
            "button.addEventListener('click', () => frameMarkers(true))",
        )
        expect(source).toMatch(
            /if \(colorMode\.value === 'dark'\) tintDarkMap\(map!\)/,
        )
    })

    it('never lets a tap on a pin reach the map, so it cannot move the gym', () => {
        expect(source).toMatch(
            /element\.addEventListener\('click', \(event\) => \{\s+event\.stopPropagation\(\)\s+if \(!props\.draggable\) emit\('select', m\.id\)/,
        )
    })

    it('keeps page gestures off the map canvas', () => {
        expect(source).toMatch(
            /\.gym-location-map \.maplibregl-canvas-container \{\s+touch-action: none;/,
        )
    })
})
