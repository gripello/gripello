import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { useTemplateRef } from 'vue'
import MapView from '~/components/map/MapView.vue'
import MapFloorLayer from '~/components/map/FloorLayer.vue'
import MapCanvas from '~/components/map/MapCanvas.vue'
import MapRouteMarker from '~/components/map/RouteMarker.vue'
import { useSvgPanZoom } from '~/composables/useSvgPanZoom'
import { useCoarsePointer } from '~/composables/useCoarsePointer'

vi.stubGlobal('useTemplateRef', useTemplateRef)
vi.stubGlobal('useSvgPanZoom', useSvgPanZoom)
vi.stubGlobal('useCoarsePointer', useCoarsePointer)

const map = {
    width: 40,
    height: 30,
    shapes: [
        {
            kind: 'floor' as const,
            points: [
                [0, 0],
                [40, 0],
                [40, 30],
            ] as [number, number][],
        },
    ],
}

const walls = [
    {
        id: 'north',
        location: 'hall',
        name: 'North',
        sort: 1,
        outline: [
            [2, 2],
            [38, 2],
            [38, 5],
        ] as [number, number][],
        edge: [
            [2, 5],
            [38, 5],
        ] as [number, number][],
    },
]

const routes = [
    {
        id: 'r1',
        name: 'One',
        color: '#e53935',
        wall: 'north',
        wall_position: 0.2,
    },
    {
        id: 'r2',
        name: 'Two',
        color: '#1e88e5',
        wall: 'north',
        wall_position: 0.8,
    },
    { id: 'r3', name: 'Loose', color: '#43a047', wall: null },
]

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(MapView, {
        props: { map, walls, routes, ...props },
        global: {
            mocks: { $t: (key: string) => key },
            components: { MapFloorLayer, MapCanvas, MapRouteMarker },
            stubs: { UButton: true },
        },
    })
}

describe('MapView', () => {
    it('draws the floor, the walls and one dot per placed route', () => {
        const wrapper = createWrapper()
        expect(wrapper.findAll('[data-testid="map-floor-shape"]')).toHaveLength(
            1,
        )
        expect(wrapper.findAll('[data-testid="map-wall"]')).toHaveLength(1)
        const dots = wrapper.findAll('[data-testid="map-route-dot"]')
        expect(dots.map((dot) => dot.attributes('data-color'))).toEqual([
            '#E53935',
            '#1E88E5',
        ])
    })

    it('marks sent routes and dims routes outside the filter', () => {
        const wrapper = createWrapper({
            sentIds: new Set(['r1']),
            matchingIds: new Set(['r2']),
            showSent: true,
        })
        const [first, second] = wrapper.findAll('[data-testid="map-route-dot"]')
        expect(first!.attributes('data-sent')).toBe('true')
        expect(first!.attributes('data-dimmed')).toBe('true')
        expect(second!.attributes('data-dimmed')).toBeUndefined()
        expect(
            wrapper.get('[data-testid="map-wall"]').attributes('aria-label'),
        ).toBe('map.wallSentLabel')
    })

    it('reports taps on walls, dots and the empty floor', async () => {
        const wrapper = createWrapper({ selectedWallId: 'north' })
        expect(
            wrapper.get('[data-testid="map-wall"]').attributes('aria-pressed'),
        ).toBe('true')

        await wrapper.get('[data-testid="map-route-dot"]').trigger('click')
        await wrapper.get('[data-testid="map-wall"]').trigger('click')
        await wrapper.get('[data-testid="map-wall"]').trigger('keydown', {
            key: 'Enter',
        })
        await wrapper.get('[data-testid="map-svg"]').trigger('click')

        expect(wrapper.emitted('selectRoute')).toEqual([['r1']])
        expect(wrapper.emitted('selectWall')).toEqual([
            ['north'],
            ['north'],
            [null],
        ])
    })

    it('shows grades on isolated routes and dots where routes overlap', () => {
        const wrapper = createWrapper({
            routes: [
                { ...routes[0]!, grade: '6A' },
                { ...routes[1]!, grade: '6B' },
                {
                    id: 'r4',
                    name: 'Crowded',
                    color: '#43a047',
                    grade: '7A',
                    wall: 'north',
                    wall_position: 0.8001,
                },
            ],
        })
        const grades = wrapper.findAll('[data-testid="map-dot-grade"]')
        expect(grades.map((grade) => grade.text())).toEqual(['6A'])
        expect(
            wrapper
                .get('[data-testid="map-route-cluster"]')
                .attributes('data-count'),
        ).toBe('2')
    })

    it('spreads a selected cluster as grade circles', () => {
        const wrapper = createWrapper({
            selectedRouteId: 'r2',
            routes: [
                { ...routes[1]!, grade: '6B' },
                {
                    id: 'r4',
                    name: 'Crowded',
                    color: '#43a047',
                    grade: '7A',
                    wall: 'north',
                    wall_position: 0.8001,
                },
            ],
        })
        expect(
            wrapper
                .findAll('[data-testid="map-dot-grade"]')
                .map((grade) => grade.text()),
        ).toEqual(['6B', '7A'])
        expect(wrapper.findAll('.map-dot-leader')).toHaveLength(2)
    })

    it('names each status badge on hover', () => {
        const wrapper = createWrapper({
            routes: [{ ...routes[0]!, grade: '6A' }],
            sentIds: new Set(['r1']),
            defects: new Map([['r1', 'urgent']]),
        })
        expect(
            wrapper
                .findAll('.map-dot-badge title')
                .map((title) => title.text()),
        ).toEqual(['ticks.sent', 'tasks.defect.marker'])
    })
})
