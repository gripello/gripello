import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MapFloorLayer from '~/components/map/FloorLayer.vue'
import type { MapShape } from '#shared/utils/mapGeometry'

const square = (size: number): MapShape['points'] => [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
]

function render(shapes: MapShape[], pixelsPerUnit?: number) {
    return mount(MapFloorLayer, {
        props: { shapes, pixelsPerUnit },
        global: { mocks: { $t: (key: string) => key } },
    })
}

describe('MapFloorLayer', () => {
    it('marks walkways and entrances with an icon when there is room', () => {
        const wrapper = render(
            [
                { kind: 'floor', points: square(20) },
                { kind: 'path', points: square(6) },
                { kind: 'entrance', points: square(3) },
                { kind: 'entrance', points: square(1) },
            ],
            20,
        )
        expect(
            wrapper
                .findAll('[data-testid="map-floor-marker"]')
                .map((marker) => marker.attributes('data-kind')),
        ).toEqual(['path', 'entrance'])
    })

    it('draws lines open and skips markers without a scale', () => {
        const wrapper = render([
            {
                kind: 'line',
                points: [
                    [0, 0],
                    [4, 0],
                ],
            },
            { kind: 'path', points: square(6) },
        ])
        expect(wrapper.get('[data-kind="line"]').attributes('d')).not.toContain(
            'Z',
        )
        expect(
            wrapper.findAll('[data-testid="map-floor-marker"]'),
        ).toHaveLength(0)
    })
})
