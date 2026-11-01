import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import MapEditorCanvas from '~/components/map/EditorCanvas.vue'
import MapCanvas from '~/components/map/MapCanvas.vue'
import MapFloorLayer from '~/components/map/FloorLayer.vue'
import { useMapEditor } from '~/composables/useMapEditor'
import { useMapEditorGestures } from '~/composables/useMapEditorGestures'
import { addWall, newFloorPlan, updateWall } from '~/utils/mapEditor'

let images: { src: string; onload?: () => void; onerror?: () => void }[] = []

beforeEach(() => {
    images = []
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useMapEditorGestures', useMapEditorGestures)
    vi.stubGlobal('useCoarsePointer', () => ref(false))
    vi.stubGlobal('useSvgPanZoom', () => ({
        svgRef: ref(null),
        isPanning: ref(false),
        viewBoxAttr: ref('0 0 10 10'),
        pixelsPerUnit: ref(10),
        toMap: ({ x, y }: { x: number; y: number }) => [x / 10, y / 10],
        adoptPointer: vi.fn(),
        fitAll: vi.fn(),
        zoomBy: vi.fn(),
    }))
    vi.stubGlobal(
        'Image',
        class {
            src = ''
            naturalWidth = 200
            naturalHeight = 100
            onload?: () => void
            onerror?: () => void
            constructor() {
                images.push(this)
            }
        },
    )
})

function setup(traceUrl: string | null = null) {
    const editor = useMapEditor()
    const withWall = updateWall(
        addWall({ map: newFloorPlan(10, 10), walls: [] }, 'w', 'Cave'),
        'w',
        {
            outline: [
                [2, 2],
                [6, 2],
                [6, 6],
            ],
            edge: [
                [2, 2],
                [6, 2],
            ],
        },
    )
    editor.load({
        ...withWall,
        map: {
            ...withWall.map,
            trace: { x: 0, y: 0, width: 10, opacity: 0.5 },
        },
    })
    const wrapper = mount(MapEditorCanvas, {
        props: { editor, grid: 0, traceUrl },
        global: {
            components: { MapCanvas, MapFloorLayer },
            mocks: { $t: (key: string) => key },
            stubs: { UButton: true },
        },
        attachTo: document.body,
    })
    const svg = wrapper.get('svg')
    const click = (x: number, y: number) =>
        svg.element.dispatchEvent(
            new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }),
        )
    return { editor, wrapper, svg, click }
}

describe('MapEditorCanvas', () => {
    it('draws a floor shape snapping to corners and closes it near its first point', async () => {
        const { editor, click } = setup()
        editor.selectTool('shape')
        click(80, 80)
        click(95, 80)
        click(95, 95)
        expect(editor.draft.value).toEqual([
            [8, 8],
            [9.5, 8],
            [10, 10],
        ])

        click(85, 80)
        expect(editor.state.value.map.shapes).toHaveLength(2)
        expect(editor.state.value.map.shapes[1]?.points).toHaveLength(3)
        expect(editor.tool.value).toBe('select')
        expect(editor.selection.value).toEqual({ kind: 'shape', index: 1 })
    })

    it('keeps an edge open near its start and finishes it on double click', async () => {
        const { editor, wrapper, svg, click } = setup()
        editor.selection.value = { kind: 'wall', key: 'w' }
        editor.selectTool('edge')
        click(30, 70)
        click(70, 70)
        click(32, 70)
        expect(editor.draft.value).toHaveLength(3)

        await svg.trigger('dblclick')
        expect(editor.state.value.walls[0]?.edge).toEqual([
            [3, 7],
            [7, 7],
            [3.2, 7],
        ])
        expect(editor.tool.value).toBe('select')
        expect(wrapper.emitted('trace-error')).toBeUndefined()
    })

    it('selects a wall with its handles and clears the selection on the background', async () => {
        const { editor, wrapper } = setup()
        expect(wrapper.find('[data-testid="map-editor-vertex"]').exists()).toBe(
            false,
        )

        await wrapper.get('[data-testid="map-editor-wall"]').trigger('click')
        expect(editor.selection.value).toEqual({ kind: 'wall', key: 'w' })
        const vertices = wrapper.findAll('[data-testid="map-editor-vertex"]')
        expect(
            vertices.map((vertex) => vertex.attributes('data-path')),
        ).toEqual(['outline', 'outline', 'outline', 'edge', 'edge'])
        expect(
            wrapper.findAll('[data-testid="map-editor-midpoint"]'),
        ).toHaveLength(4)
        expect(wrapper.find('[data-testid="map-editor-move"]').exists()).toBe(
            true,
        )

        await vertices[1]!.trigger('keydown', { key: 'Enter' })
        expect(editor.selectedVertex.value).toEqual({
            path: { type: 'outline', key: 'w' },
            index: 1,
        })

        await wrapper.get('.editor-background').trigger('click')
        expect(editor.selection.value).toBeNull()
        expect(editor.selectedVertex.value).toBeNull()
    })

    it('ignores wall clicks while drawing', async () => {
        const { editor, wrapper } = setup()
        editor.selectTool('shape')
        await wrapper.get('[data-testid="map-editor-wall"]').trigger('click')
        expect(editor.selection.value).toBeNull()
        expect(editor.draft.value).toHaveLength(1)
    })

    it('places a wall label only inside its outline', async () => {
        const { editor, click } = setup()
        editor.selection.value = { kind: 'wall', key: 'w' }
        editor.selectTool('label')
        click(90, 90)
        expect(editor.tool.value).toBe('label')
        expect(editor.state.value.walls[0]?.label).toBeNull()

        click(50, 30)
        expect(editor.state.value.walls[0]?.label).toEqual([5, 3])
        expect(editor.tool.value).toBe('select')
    })

    it('shows the trace frame only with the trace tool and sizes it from the image', async () => {
        const { editor, wrapper, click } = setup('blob:trace')
        expect(images[0]?.src).toBe('blob:trace')
        const trace = () => wrapper.get('[data-testid="map-editor-trace"]')
        expect(trace().attributes('height')).toBe('10')

        images[0]!.onload!()
        await wrapper.vm.$nextTick()
        expect(trace().attributes('height')).toBe('5')

        expect(
            wrapper.find('[data-testid="map-editor-trace-frame"]').exists(),
        ).toBe(false)
        editor.selectTool('trace')
        await wrapper.vm.$nextTick()
        expect(
            wrapper.find('[data-testid="map-editor-trace-frame"]').exists(),
        ).toBe(true)
        click(50, 50)
        expect(editor.draft.value).toEqual([])
    })

    it('reports a trace image that fails to load, but not a replaced one', async () => {
        const { wrapper } = setup('blob:old')
        await wrapper.setProps({ traceUrl: 'blob:new' })
        images[0]!.onerror!()
        expect(wrapper.emitted('trace-error')).toBeUndefined()
        images[1]!.onerror!()
        expect(wrapper.emitted('trace-error')).toHaveLength(1)
    })
})
