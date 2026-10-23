import { describe, expect, it } from 'vitest'
import { useMapEditor } from '~/composables/useMapEditor'
import {
    addWall,
    newFloorPlan,
    updateWall,
    wallChanges,
} from '~/utils/mapEditor'

function setup() {
    const editor = useMapEditor()
    editor.load({ map: newFloorPlan(10, 10), walls: [] })
    return editor
}

describe('useMapEditor', () => {
    it('tracks dirty state, undo and redo', () => {
        const editor = setup()
        const loaded = editor.state.value
        editor.commit(addWall(loaded, 'w', 'Cave'))

        expect(editor.isDirty.value).toBe(true)
        expect(editor.canUndo.value).toBe(true)

        editor.undo()
        expect(editor.state.value).toBe(loaded)
        expect(editor.isDirty.value).toBe(false)
        expect(editor.canRedo.value).toBe(true)

        editor.redo()
        expect(editor.state.value.walls[0]?.name).toBe('Cave')
    })

    it('records a gesture as one undo step', () => {
        const editor = setup()
        const start = editor.state.value
        editor.beginGesture()
        expect(editor.inGesture()).toBe(true)
        editor.preview(addWall(start, 'a', 'A'))
        editor.preview(addWall(start, 'b', 'B'))
        editor.endGesture()

        expect(editor.inGesture()).toBe(false)
        editor.undo()
        expect(editor.state.value).toBe(start)
        expect(editor.canUndo.value).toBe(false)
    })

    it('skips history for a gesture that changed nothing', () => {
        const editor = setup()
        editor.beginGesture()
        editor.endGesture()
        expect(editor.canUndo.value).toBe(false)
    })

    it('drops a selection that undo removed', () => {
        const editor = setup()
        editor.commit(addWall(editor.state.value, 'w', 'Cave'))
        editor.selection.value = { kind: 'wall', key: 'w' }
        editor.selectedVertex.value = {
            path: { type: 'outline', key: 'w' },
            index: 0,
        }

        editor.undo()
        expect(editor.selection.value).toBeNull()
        expect(editor.selectedVertex.value).toBeNull()
    })

    it('finishes a shape draft and selects it', () => {
        const editor = setup()
        editor.shapeKind.value = 'mat'
        editor.selectTool('shape')
        editor.draft.value = [
            [1, 1],
            [2, 1],
        ]
        expect(editor.canFinish.value).toBe(false)

        editor.draft.value = [...editor.draft.value, [2, 2], [2, 2]]
        expect(editor.canFinish.value).toBe(true)
        editor.finishDraft()

        const shapes = editor.state.value.map.shapes
        expect(shapes.at(-1)).toEqual({
            kind: 'mat',
            points: [
                [1, 1],
                [2, 1],
                [2, 2],
            ],
        })
        expect(editor.selection.value).toEqual({
            kind: 'shape',
            index: shapes.length - 1,
        })
        expect(editor.tool.value).toBe('select')
        expect(editor.draft.value).toEqual([])
    })

    it('moves from outline to edge for a wall without an edge', () => {
        const editor = setup()
        editor.commit(addWall(editor.state.value, 'w', 'Cave'))
        editor.selection.value = { kind: 'wall', key: 'w' }
        editor.selectTool('outline')
        editor.draft.value = [
            [1, 1],
            [3, 1],
            [3, 3],
        ]
        editor.finishDraft()
        expect(editor.tool.value).toBe('edge')
        expect(editor.isDrawing.value).toBe(true)

        editor.draft.value = [
            [1, 1],
            [3, 1],
        ]
        editor.finishDraft()
        expect(editor.tool.value).toBe('select')
        expect(editor.selectedWall.value?.edge).toEqual([
            [1, 1],
            [3, 1],
        ])
    })

    it('ignores a draft below the minimum', () => {
        const editor = setup()
        editor.selectTool('shape')
        editor.draft.value = [
            [1, 1],
            [1, 1],
            [2, 2],
        ]
        editor.finishDraft()
        expect(editor.state.value.map.shapes).toHaveLength(1)
        expect(editor.tool.value).toBe('shape')
    })

    it('removes the selected point unless the path is at its minimum', () => {
        const editor = setup()
        const withWall = addWall(editor.state.value, 'w', 'Cave')
        editor.commit(
            updateWall(withWall, 'w', {
                edge: [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                ],
            }),
        )
        const path = { type: 'edge' as const, key: 'w' }
        editor.selectedVertex.value = { path, index: 1 }

        expect(editor.removeSelectedVertex()).toBe(true)
        expect(editor.selectedWall.value).toBeNull()
        expect(editor.state.value.walls[0]?.edge).toEqual([
            [0, 0],
            [2, 0],
        ])

        editor.selectedVertex.value = { path, index: 0 }
        expect(editor.removeSelectedVertex()).toBe(false)
    })

    it('resets selection, tool and history on load', () => {
        const editor = setup()
        editor.commit(addWall(editor.state.value, 'w', 'Cave'))
        editor.selectTool('edge')
        editor.draft.value = [[1, 1]]

        editor.load({ map: newFloorPlan(20, 20), walls: [] })
        expect(editor.tool.value).toBe('select')
        expect(editor.draft.value).toEqual([])
        expect(editor.canUndo.value).toBe(false)
        expect(editor.isDirty.value).toBe(false)
    })

    it('cancels a gesture back to where it started', () => {
        const editor = setup()
        const start = editor.state.value
        editor.beginGesture()
        editor.preview(addWall(start, 'a', 'A'))
        editor.cancelGesture()

        expect(editor.state.value).toBe(start)
        expect(editor.inGesture()).toBe(false)
        expect(editor.canUndo.value).toBe(false)
    })

    it('finishes a line with two points', () => {
        const editor = setup()
        editor.shapeKind.value = 'line'
        editor.selectTool('shape')
        editor.draft.value = [
            [1, 1],
            [3, 1],
        ]
        expect(editor.canFinish.value).toBe(true)
        editor.finishDraft()
        expect(editor.state.value.map.shapes.at(-1)?.kind).toBe('line')
    })

    it('gives created walls their saved id in the undo and redo history', () => {
        const editor = setup()
        editor.addNewWall('Cave')
        const key = editor.state.value.walls[0]!.key
        editor.commit(updateWall(editor.state.value, key, { name: 'Roof' }))
        editor.commit(updateWall(editor.state.value, key, { name: 'Slab' }))
        editor.undo()

        const savedId = 'w1234567890abcd'
        const createdIdByKey = new Map([[key, savedId]])
        editor.markSaved(
            {
                ...editor.state.value,
                walls: editor.state.value.walls.map((wall) => ({
                    ...wall,
                    id: savedId,
                    key: savedId,
                })),
            },
            createdIdByKey,
        )
        expect(editor.selection.value).toEqual({ kind: 'wall', key: savedId })

        editor.undo()
        expect(editor.state.value.walls).toMatchObject([
            { id: savedId, key: savedId, name: 'Cave' },
        ])
        expect(
            wallChanges(editor.saved.value.walls, editor.state.value.walls),
        ).toMatchObject({ create: [], remove: [], update: [{ id: savedId }] })

        editor.redo()
        editor.redo()
        expect(editor.state.value.walls).toMatchObject([
            { id: savedId, key: savedId, name: 'Slab' },
        ])
    })
})
