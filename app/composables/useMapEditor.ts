import {
    MAP_LIMITS,
    shapeMinPoints,
    type MapPoint,
    type MapShapeKind,
} from '#shared/utils/mapGeometry'
import {
    addShape,
    addWall,
    minPointsFor,
    newFloorPlan,
    readPath,
    removeVertex,
    updateWall,
    withoutRepeats,
    writePath,
    type EditorPath,
    type EditorState,
    type EditorTool,
} from '~/utils/mapEditor'

export type EditorSelection =
    { kind: 'shape'; index: number } | { kind: 'wall'; key: string }

const HISTORY_LIMIT = 100

export function useMapEditor() {
    const state = shallowRef<EditorState>({
        map: newFloorPlan(40, 30),
        walls: [],
    })
    const saved = shallowRef<EditorState>(state.value)
    const past = shallowRef<EditorState[]>([])
    const future = shallowRef<EditorState[]>([])

    const tool = ref<EditorTool>('select')
    const shapeKind = ref<MapShapeKind>('floor')
    const selection = ref<EditorSelection | null>(null)
    const selectedVertex = ref<{ path: EditorPath; index: number } | null>(null)
    const draft = ref<MapPoint[]>([])

    let gestureStart: EditorState | null = null

    const isDirty = computed(
        () => JSON.stringify(state.value) !== JSON.stringify(saved.value),
    )
    const canUndo = computed(() => past.value.length > 0)
    const canRedo = computed(() => future.value.length > 0)
    const isDrawing = computed(() =>
        ['shape', 'outline', 'edge'].includes(tool.value),
    )
    const draftMinimum = computed(() => {
        if (tool.value === 'edge') return MAP_LIMITS.edgeMinPoints
        if (tool.value === 'shape') return shapeMinPoints(shapeKind.value)
        return MAP_LIMITS.shapeMinPoints
    })
    const canFinish = computed(
        () => isDrawing.value && draft.value.length >= draftMinimum.value,
    )
    const selectedWall = computed(() => {
        const current = selection.value
        if (current?.kind !== 'wall') return null
        return (
            state.value.walls.find((wall) => wall.key === current.key) ?? null
        )
    })

    function pushHistory(previous: EditorState) {
        past.value = [...past.value, previous].slice(-HISTORY_LIMIT)
        future.value = []
    }

    function load(next: EditorState) {
        state.value = next
        saved.value = next
        past.value = []
        future.value = []
        selection.value = null
        selectedVertex.value = null
        draft.value = []
        tool.value = 'select'
    }

    function markSaved(next: EditorState) {
        state.value = next
        saved.value = next
    }

    function commit(next: EditorState) {
        if (next === state.value) return
        pushHistory(state.value)
        state.value = next
    }

    function beginGesture() {
        gestureStart = state.value
    }

    function preview(next: EditorState) {
        state.value = next
    }

    function cancelGesture() {
        if (gestureStart) state.value = gestureStart
        gestureStart = null
    }

    function inGesture() {
        return gestureStart !== null
    }

    function endGesture() {
        if (gestureStart && gestureStart !== state.value)
            pushHistory(gestureStart)
        gestureStart = null
    }

    function repairSelection() {
        const current = selection.value
        if (
            (current?.kind === 'shape' &&
                !state.value.map.shapes[current.index]) ||
            (current?.kind === 'wall' && !selectedWall.value)
        )
            selection.value = null
        selectedVertex.value = null
    }

    function undo() {
        const previous = past.value.at(-1)
        if (!previous) return
        future.value = [state.value, ...future.value]
        past.value = past.value.slice(0, -1)
        state.value = previous
        repairSelection()
    }

    function redo() {
        const [next, ...rest] = future.value
        if (!next) return
        past.value = [...past.value, state.value]
        future.value = rest
        state.value = next
        repairSelection()
    }

    function selectTool(next: EditorTool) {
        tool.value = next
        draft.value = []
    }

    function finishDraft() {
        if (!isDrawing.value) return
        const points = withoutRepeats(draft.value)
        const current = tool.value
        const wall = selectedWall.value
        if (points.length < draftMinimum.value) return

        if (current === 'shape') {
            const next = addShape(state.value, shapeKind.value, points)
            commit(next)
            selection.value = {
                kind: 'shape',
                index: next.map.shapes.length - 1,
            }
            selectTool('select')
        } else if (wall && current === 'outline') {
            commit(updateWall(state.value, wall.key, { outline: points }))
            selectTool(wall.edge.length ? 'select' : 'edge')
        } else if (wall && current === 'edge') {
            commit(updateWall(state.value, wall.key, { edge: points }))
            selectTool('select')
        }
    }

    function addNewWall(name: string) {
        const key = `new-${Date.now()}`
        commit(addWall(state.value, key, name))
        selection.value = { kind: 'wall', key }
        selectedVertex.value = null
        selectTool('outline')
    }

    function removeSelectedVertex() {
        const selected = selectedVertex.value
        if (!selected) return false
        const remaining = removeVertex(
            readPath(state.value, selected.path),
            selected.index,
            minPointsFor(state.value, selected.path),
        )
        if (!remaining) return false
        commit(writePath(state.value, selected.path, remaining))
        selectedVertex.value = null
        return true
    }

    return {
        state,
        saved,
        tool,
        shapeKind,
        selection,
        selectedVertex,
        selectedWall,
        draft,
        isDirty,
        canUndo,
        canRedo,
        isDrawing,
        canFinish,
        load,
        markSaved,
        commit,
        beginGesture,
        preview,
        endGesture,
        inGesture,
        cancelGesture,
        undo,
        redo,
        selectTool,
        finishDraft,
        addNewWall,
        removeSelectedVertex,
    }
}
