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
    it('shows grades where routes have room and clusters where they crowd', () => {
        const wrapper = createWrapper()
        expect(wrapper.findAll('[data-testid="placement-dot"]')).toHaveLength(1)
        expect(
            wrapper
                .findAll('[data-testid="map-dot-grade"]')
                .map((grade) => grade.text()),
        ).toEqual(['6A'])
        expect(
            wrapper
                .get('[data-testid="placement-cluster"]')
                .attributes('data-count'),
        ).toBe('2')
    })

    it('keeps the cluster of the selected route open', () => {
        const wrapper = createWrapper({ selectedRouteId: 'r3' })
        expect(wrapper.findAll('[data-testid="placement-dot"]')).toHaveLength(3)
        expect(wrapper.find('[data-testid="placement-cluster"]').exists()).toBe(
            false,
        )
    })

    it('selects a route on Enter', async () => {
        const wrapper = createWrapper()
        await wrapper
            .get('[data-testid="placement-dot"][data-route-id="r1"]')
            .trigger('keydown', { key: 'Enter' })
        expect(wrapper.emitted('selectRoute')).toEqual([['r1']])
    })

    it('places the armed route next to the focused one', async () => {
        const wrapper = createWrapper({ armedRouteId: 'r2' })
        await wrapper
            .get('[data-testid="placement-dot"][data-route-id="r1"]')
            .trigger('keydown', { key: 'Enter' })
        expect(wrapper.emitted('place')).toEqual([['r2', 'north', 0.2]])
    })

    it('previews the dragged route as its full grade marker', async () => {
        const wrapper = createWrapper()
        ;(
            wrapper.vm as unknown as {
                previewAt: (id: string, x: number, y: number) => void
            }
        ).previewAt('r3', 0, 0)
        await wrapper.vm.$nextTick()
        const ghost = wrapper.get('[data-testid="placement-ghost"]')
        expect(ghost.get('.map-dot-body').attributes('fill')).toBe('#43A047')
        expect(ghost.get('[data-testid="map-dot-grade"]').text()).toBe('7A')
    })

    it('hands a dot drag to the map when a second finger lands', async () => {
        const proto = Element.prototype as unknown as Record<string, unknown>
        proto.setPointerCapture ??= () => {}
        proto.hasPointerCapture ??= () => false
        const wrapper = createWrapper()
        const dot = wrapper.get(
            '[data-testid="placement-dot"][data-route-id="r1"]',
        ).element
        const pointer = (type: string, pointerId: number) =>
            Object.assign(new Event(type, { bubbles: true }), {
                pointerId,
                button: 0,
                clientX: 10,
                clientY: 10,
            })
        dot.dispatchEvent(pointer('pointerdown', 1))
        window.dispatchEvent(pointer('pointerdown', 2))
        dot.dispatchEvent(pointer('pointerup', 1))
        expect(wrapper.emitted('selectRoute')).toBeUndefined()
        expect(wrapper.emitted('place')).toBeUndefined()
    })

    it('drops a running dot drag when the map unmounts', () => {
        const proto = Element.prototype as unknown as Record<string, unknown>
        proto.setPointerCapture ??= () => {}
        const wrapper = createWrapper()
        const dot = wrapper.get(
            '[data-testid="placement-dot"][data-route-id="r1"]',
        ).element
        dot.dispatchEvent(
            Object.assign(new Event('pointerdown', { bubbles: true }), {
                pointerId: 1,
                button: 0,
                clientX: 10,
                clientY: 10,
            }),
        )
        const removed = vi.spyOn(window, 'removeEventListener')
        wrapper.unmount()
        expect(removed).toHaveBeenCalledWith(
            'pointerdown',
            expect.any(Function),
            true,
        )
        removed.mockRestore()
    })
})
