import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { useTemplateRef } from 'vue'
import PlacementCanvas from '~/components/map/PlacementCanvas.vue'
import MapFloorLayer from '~/components/map/FloorLayer.vue'
import MapCanvas from '~/components/map/MapCanvas.vue'
import MapRouteMarker from '~/components/map/RouteMarker.vue'
import { useSvgPanZoom } from '~/composables/useSvgPanZoom'
import { useCoarsePointer } from '~/composables/useCoarsePointer'
import { toMapWalls } from '~/utils/gymMap'

vi.stubGlobal('useTemplateRef', useTemplateRef)
vi.stubGlobal('useSvgPanZoom', useSvgPanZoom)
vi.stubGlobal('useCoarsePointer', useCoarsePointer)

const map = { width: 40, height: 30, shapes: [] }

const walls = toMapWalls(
    [
        {
            id: 'north',
            name: 'North',
            outline: [
                [2, 2],
                [38, 2],
                [38, 5],
            ],
            edge: [
                [2, 5],
                [38, 5],
            ],
        },
    ],
    map,
)

const routes = [
    {
        id: 'r1',
        name: 'One',
        color: '#e53935',
        grade: '6A',
        wall: 'north',
        wall_position: 0.2,
    },
    {
        id: 'r2',
        name: 'Two',
        color: '#1e88e5',
        grade: '6B',
        wall: 'north',
        wall_position: 0.8,
    },
    {
        id: 'r3',
        name: 'Close',
        color: '#43a047',
        grade: '7A',
        wall: 'north',
        wall_position: 0.8001,
    },
]

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(PlacementCanvas, {
        props: {
            map,
            walls,
            routes,
            selectedRouteId: null,
            selectedWallId: null,
            armedRouteId: null,
            ...props,
        },
        global: {
            mocks: { $t: (key: string) => key },
            components: { MapFloorLayer, MapCanvas, MapRouteMarker },
            stubs: { UButton: true },
        },
    })
}

describe('PlacementCanvas', () => {
    it('shows grades where routes have room and dots where they crowd', () => {
        const wrapper = createWrapper()
        expect(wrapper.findAll('[data-testid="placement-dot"]')).toHaveLength(3)
        expect(
            wrapper
                .findAll('[data-testid="map-dot-grade"]')
                .map((grade) => grade.text()),
        ).toEqual(['6A'])
    })

    it('selects a route on Enter', async () => {
        const wrapper = createWrapper()
        await wrapper
            .get('[data-testid="placement-dot"][data-route-id="r2"]')
            .trigger('keydown', { key: 'Enter' })
        expect(wrapper.emitted('selectRoute')).toEqual([['r2']])
    })

    it('places the armed route next to the focused one', async () => {
        const wrapper = createWrapper({ armedRouteId: 'r1' })
        await wrapper
            .get('[data-testid="placement-dot"][data-route-id="r2"]')
            .trigger('keydown', { key: 'Enter' })
        expect(wrapper.emitted('place')).toEqual([['r1', 'north', 0.8]])
    })
})
