import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { ref, useTemplateRef } from 'vue'
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

describe('PlacementCanvas placing routes', () => {
    const fitTo = vi.fn()
    const zoomBy = vi.fn()

    beforeEach(() => {
        fitTo.mockReset()
        zoomBy.mockReset()
        vi.stubGlobal('useSvgPanZoom', () => ({
            svgRef: ref<SVGSVGElement | null>(null),
            isPanning: ref(false),
            viewBox: ref({ x: 0, y: 0, width: 40, height: 30 }),
            viewBoxAttr: ref('0 0 40 30'),
            limits: ref({ minWidth: 2, maxWidth: 40 }),
            pixelsPerUnit: ref(10),
            toMap: ({ x, y }: { x: number; y: number }) => [x / 10, y / 10],
            adoptPointer: vi.fn(),
            fitAll: vi.fn(),
            fitTo,
            zoomBy,
        }))
    })

    afterEach(() => {
        vi.stubGlobal('useSvgPanZoom', useSvgPanZoom)
    })

    function setup(props: Record<string, unknown> = {}) {
        const wrapper = createWrapper(props)
        const svg = wrapper.get('svg').element
        svg.getBoundingClientRect = () =>
            ({ left: 0, top: 0, right: 400, bottom: 300 }) as DOMRect
        const at = (type: string, x: number, y: number, pointerId = 1) =>
            new PointerEvent(type, {
                bubbles: true,
                button: 0,
                clientX: x,
                clientY: y,
                pointerId,
            })
        const dot = (id: string) => {
            const element = wrapper.get(
                `[data-testid="placement-dot"][data-route-id="${id}"]`,
            ).element as SVGElement
            element.setPointerCapture = () => {}
            return element
        }
        const exposed = wrapper.vm as unknown as {
            previewAt: (id: string, x: number, y: number) => void
            placeAt: (id: string, x: number, y: number) => boolean
            focusWall: (id: string) => void
        }
        return { wrapper, svg, at, dot, exposed }
    }

    const position = (wrapper: VueWrapper) =>
        wrapper.emitted<[string, string, number]>('place')!.at(-1)!

    it('places the armed route on the wall edge under a click inside the wall', () => {
        const { wrapper, svg, at } = setup({ armedRouteId: 'r9' })
        svg.dispatchEvent(at('click', 300, 30))
        const [route, wall, spot] = position(wrapper)
        expect([route, wall]).toEqual(['r9', 'north'])
        expect(spot).toBeCloseTo(28 / 36)
        expect(wrapper.emitted('selectRoute')).toBeUndefined()
    })

    it('snaps a click near a wall onto it and ignores clicks far from any wall', () => {
        const { wrapper, svg, at } = setup({ armedRouteId: 'r9' })
        svg.dispatchEvent(at('click', 200, 80))
        expect(position(wrapper)[2]).toBeCloseTo(0.5)
        svg.dispatchEvent(at('click', 200, 250))
        expect(wrapper.emitted('place')).toHaveLength(1)
    })

    it('places anywhere inside a deep wall, however far from its edge', () => {
        const deep = toMapWalls(
            [
                {
                    id: 'cave',
                    name: 'Cave',
                    outline: [
                        [2, 10],
                        [38, 10],
                        [38, 28],
                        [2, 28],
                    ],
                    edge: [
                        [2, 10],
                        [38, 10],
                    ],
                },
            ],
            map,
        )
        const { wrapper, svg, at } = setup({
            walls: deep,
            routes: [],
            armedRouteId: 'r9',
        })
        svg.dispatchEvent(at('click', 200, 250))
        const [, wall, spot] = position(wrapper)
        expect(wall).toBe('cave')
        expect(spot).toBeCloseTo(0.5)
    })

    it('clears the selection on an empty click and selects walls when nothing is armed', async () => {
        const { wrapper, svg, at } = setup()
        svg.dispatchEvent(at('click', 200, 250))
        expect(wrapper.emitted('selectRoute')).toEqual([[null]])
        expect(wrapper.emitted('selectWall')).toEqual([[null]])
        await wrapper.get('[data-testid="placement-wall"]').trigger('click')
        expect(wrapper.emitted('selectWall')?.at(-1)).toEqual(['north'])
        expect(wrapper.emitted('place')).toBeUndefined()
    })

    it('places the armed route mid-wall from the keyboard', async () => {
        const { wrapper } = setup({ armedRouteId: 'r9' })
        await wrapper
            .get('[data-testid="placement-wall"]')
            .trigger('keydown', { key: 'Enter' })
        expect(wrapper.emitted('place')).toEqual([['r9', 'north', 0.5]])
        expect(wrapper.emitted('selectWall')).toBeUndefined()
    })

    it('drags a dot to a new spot with a ghost and places it on release', async () => {
        const { wrapper, at, dot } = setup()
        const r1 = dot('r1')
        r1.dispatchEvent(at('pointerdown', 92, 50))
        r1.dispatchEvent(at('pointermove', 300, 30))
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="placement-ghost"]').exists()).toBe(
            true,
        )
        expect(r1.classList).toContain('placement-dot--dragging')

        r1.dispatchEvent(at('pointerup', 300, 30))
        await wrapper.vm.$nextTick()
        const [route, wall, spot] = position(wrapper)
        expect([route, wall]).toEqual(['r1', 'north'])
        expect(spot).toBeCloseTo(28 / 36)
        expect(wrapper.emitted('selectRoute')).toBeUndefined()
        expect(wrapper.find('[data-testid="placement-ghost"]').exists()).toBe(
            false,
        )
    })

    it('treats a tap on a dot as a selection, or as placing the armed route there', () => {
        const { wrapper, at, dot } = setup()
        const r1 = dot('r1')
        r1.dispatchEvent(at('pointerdown', 92, 50))
        r1.dispatchEvent(at('pointermove', 94, 50))
        r1.dispatchEvent(at('pointerup', 94, 50))
        expect(wrapper.emitted('selectRoute')).toEqual([['r1']])
        expect(wrapper.emitted('place')).toBeUndefined()

        const armed = setup({ armedRouteId: 'r2' })
        const tapped = armed.dot('r1')
        tapped.dispatchEvent(armed.at('pointerdown', 92, 50))
        tapped.dispatchEvent(armed.at('pointerup', 92, 50))
        expect(armed.wrapper.emitted('place')?.[0]?.slice(0, 2)).toEqual([
            'r2',
            'north',
        ])
    })

    it('drops a cancelled drag without placing anything', async () => {
        const { wrapper, at, dot } = setup()
        const r1 = dot('r1')
        r1.dispatchEvent(at('pointerdown', 92, 50))
        r1.dispatchEvent(at('pointermove', 300, 30))
        r1.dispatchEvent(at('pointercancel', 300, 30))
        r1.dispatchEvent(at('pointerup', 300, 30))
        await wrapper.vm.$nextTick()
        expect(wrapper.emitted('place')).toBeUndefined()
        expect(wrapper.emitted('selectRoute')).toBeUndefined()
        expect(wrapper.find('[data-testid="placement-ghost"]').exists()).toBe(
            false,
        )
    })

    it('places a route dropped from the list only over the canvas', async () => {
        const { wrapper, exposed } = setup()
        exposed.previewAt('r3', 300, 30)
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="placement-ghost"]').exists()).toBe(
            true,
        )
        exposed.previewAt('r3', 500, 30)
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="placement-ghost"]').exists()).toBe(
            false,
        )

        expect(exposed.placeAt('r3', 420, 50)).toBe(false)
        expect(exposed.placeAt('r3', 200, 250)).toBe(false)
        expect(wrapper.emitted('place')).toBeUndefined()
        expect(exposed.placeAt('r3', 300, 30)).toBe(true)
        expect(position(wrapper).slice(0, 2)).toEqual(['r3', 'north'])
    })

    it('zooms into a cluster, or places the armed route on it', async () => {
        const { wrapper } = setup()
        await wrapper.get('[data-testid="placement-cluster"]').trigger('click')
        expect(zoomBy).toHaveBeenCalledOnce()
        expect(wrapper.emitted('selectRoute')).toBeUndefined()

        const armed = setup({ armedRouteId: 'r9' })
        armed.wrapper
            .get('[data-testid="placement-cluster"]')
            .element.dispatchEvent(armed.at('click', 300, 30))
        expect(armed.wrapper.emitted('place')?.[0]?.slice(0, 2)).toEqual([
            'r9',
            'north',
        ])
        expect(zoomBy).toHaveBeenCalledOnce()
    })

    it('focuses a wall by fitting its outline and edge', () => {
        const { exposed } = setup()
        exposed.focusWall('north')
        expect(fitTo).toHaveBeenCalledWith(
            { minX: 2, minY: 2, maxX: 38, maxY: 5 },
            { padding: 2 },
        )
        exposed.focusWall('missing')
        expect(fitTo).toHaveBeenCalledOnce()
    })
})
