import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useMapEditor } from '~/composables/useMapEditor'
import { useMapEditorGestures } from '~/composables/useMapEditorGestures'
import { addWall, newFloorPlan, updateWall } from '~/utils/mapEditor'

vi.stubGlobal('useMapEditor', useMapEditor)

function setup() {
    const editor = useMapEditor()
    editor.load({
        map: newFloorPlan(10, 10),
        walls: [],
    })
    editor.commit(
        updateWall(addWall(editor.state.value, 'w', 'Cave'), 'w', {
            outline: [
                [1, 1],
                [4, 1],
                [4, 4],
            ],
        }),
    )
    const panZoom = {
        toMap: ({ x, y }: { x: number; y: number }) => [x / 10, y / 10],
        adoptPointer: vi.fn(),
        pixelsPerUnit: ref(10),
    }
    const gestures = useMapEditorGestures({
        editor,
        panZoom: panZoom as never,
        grid: () => 0,
        snapPx: () => 0,
    })
    const handle = document.createElement('div')
    handle.setPointerCapture = vi.fn()
    handle.releasePointerCapture = vi.fn()
    handle.hasPointerCapture = () => true
    return { editor, panZoom, gestures, handle }
}

function pointer(type: string, x: number, y: number, pointerId = 1) {
    return new PointerEvent(type, {
        button: 0,
        clientX: x,
        clientY: y,
        pointerId,
    })
}

function press(handle: HTMLElement, x: number, y: number) {
    const event = pointer('pointerdown', x, y)
    Object.defineProperty(event, 'currentTarget', { value: handle })
    return event
}

describe('useMapEditorGestures', () => {
    it('drags a vertex as one undo step and leaves taps alone', () => {
        const { editor, gestures, handle } = setup()
        const path = { type: 'outline' as const, key: 'w' }
        const before = editor.state.value

        gestures.onVertexDown(path, 0, press(handle, 10, 10))
        handle.dispatchEvent(pointer('pointerup', 11, 10))
        expect(editor.state.value).toBe(before)
        expect(editor.selectedVertex.value).toEqual({ path, index: 0 })

        gestures.onVertexDown(path, 0, press(handle, 10, 10))
        handle.dispatchEvent(pointer('pointermove', 20, 20))
        handle.dispatchEvent(pointer('pointerup', 20, 20))
        expect(editor.state.value.walls[0]!.outline[0]).toEqual([2, 2])
        editor.undo()
        expect(editor.state.value).toBe(before)
    })

    it('hands a drag to pinch when a second finger lands', () => {
        const { editor, panZoom, gestures, handle } = setup()
        const before = editor.state.value
        gestures.onVertexDown(
            { type: 'outline', key: 'w' },
            0,
            press(handle, 10, 10),
        )
        handle.dispatchEvent(pointer('pointermove', 30, 30))
        window.dispatchEvent(pointer('pointerdown', 50, 50, 2))
        expect(editor.state.value).toBe(before)
        expect(panZoom.adoptPointer).toHaveBeenCalledWith(1, { x: 30, y: 30 })
    })
})
