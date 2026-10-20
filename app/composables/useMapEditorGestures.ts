import {
    roundToCm,
    snapPoint,
    type MapPoint,
    type MapTrace,
} from '#shared/utils/mapGeometry'
import {
    clampToMap,
    insertVertex,
    moveVertex,
    readPath,
    snapToVertices,
    translatePoints,
    updateWall,
    writePath,
    type EditorPath,
    type EditorState,
    type EditorWall,
} from '~/utils/mapEditor'

const DRAG_START_PX = 4

export function useMapEditorGestures(options: {
    editor: ReturnType<typeof useMapEditor>
    panZoom: Pick<
        ReturnType<typeof useSvgPanZoom>,
        'toMap' | 'adoptPointer' | 'pixelsPerUnit'
    >
    grid: () => number
    snapPx: () => number
}) {
    const { editor, panZoom } = options

    function allVertices(except?: { path: EditorPath; index: number }) {
        const state = editor.state.value
        const exceptKey = except ? JSON.stringify(except.path) : ''
        const paths: EditorPath[] = [
            ...state.map.shapes.map((_, index) => ({
                type: 'shape' as const,
                index,
            })),
            ...state.walls.flatMap((wall) => [
                { type: 'outline' as const, key: wall.key },
                { type: 'edge' as const, key: wall.key },
            ]),
        ]
        return paths.flatMap((path) =>
            readPath(state, path).filter(
                (_, index) =>
                    JSON.stringify(path) !== exceptKey ||
                    index !== except!.index,
            ),
        )
    }

    function snapped(
        client: { clientX: number; clientY: number },
        except?: { path: EditorPath; index: number },
    ): MapPoint {
        const raw = panZoom.toMap({ x: client.clientX, y: client.clientY })
        const vertex = snapToVertices(
            raw,
            allVertices(except),
            options.snapPx() / panZoom.pixelsPerUnit.value,
        )
        return clampToMap(
            vertex ?? snapPoint(raw, options.grid()),
            editor.state.value.map,
        )
    }

    function trackDrag(
        event: PointerEvent,
        onMove: (move: PointerEvent) => void,
        hooks: { onStart?: () => void; onTap?: () => void } = {},
    ) {
        const target = event.currentTarget as SVGElement
        const pointerId = event.pointerId
        target.setPointerCapture(pointerId)
        const origin = { x: event.clientX, y: event.clientY }
        let last = origin
        let started = false

        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return
            last = { x: moveEvent.clientX, y: moveEvent.clientY }
            if (!started) {
                if (
                    Math.hypot(last.x - origin.x, last.y - origin.y) <
                    DRAG_START_PX
                )
                    return
                started = true
                editor.beginGesture()
                hooks.onStart?.()
            }
            onMove(moveEvent)
        }
        const stop = () => {
            target.removeEventListener('pointermove', move)
            target.removeEventListener('pointerup', end)
            target.removeEventListener('pointercancel', end)
            window.removeEventListener('pointerdown', secondPointer, true)
        }
        const end = (endEvent: PointerEvent) => {
            if (endEvent.pointerId !== pointerId) return
            stop()
            if (started) editor.endGesture()
            else if (endEvent.type === 'pointerup') hooks.onTap?.()
        }
        const secondPointer = (other: PointerEvent) => {
            if (other.pointerId === pointerId) return
            stop()
            if (started) editor.cancelGesture()
            if (target.hasPointerCapture(pointerId))
                target.releasePointerCapture(pointerId)
            panZoom.adoptPointer(pointerId, last)
        }
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', end)
        target.addEventListener('pointercancel', end)
        window.addEventListener('pointerdown', secondPointer, true)
    }

    function selectVertex(path: EditorPath, index: number) {
        editor.selectedVertex.value = { path, index }
    }

    function onVertexDown(
        path: EditorPath,
        index: number,
        event: PointerEvent,
    ) {
        if (event.button !== 0) return
        selectVertex(path, index)
        trackDrag(event, (move) => {
            const point = snapped(move, { path, index })
            const state = editor.state.value
            editor.preview(
                writePath(
                    state,
                    path,
                    moveVertex(readPath(state, path), index, point),
                ),
            )
        })
    }

    function insertMidpoint(
        path: EditorPath,
        midpoint: { afterIndex: number; point: MapPoint },
    ) {
        const state = editor.state.value
        editor.commit(
            writePath(
                state,
                path,
                insertVertex(
                    readPath(state, path),
                    midpoint.afterIndex,
                    midpoint.point,
                ),
            ),
        )
        selectVertex(path, midpoint.afterIndex + 1)
    }

    function onMidpointDown(
        path: EditorPath,
        midpoint: { afterIndex: number; point: MapPoint },
        event: PointerEvent,
    ) {
        if (event.button !== 0) return
        const index = midpoint.afterIndex + 1
        trackDrag(
            event,
            (move) => {
                const point = snapped(move, { path, index })
                const state = editor.state.value
                editor.preview(
                    writePath(
                        state,
                        path,
                        moveVertex(readPath(state, path), index, point),
                    ),
                )
            },
            {
                onStart: () => {
                    const state = editor.state.value
                    editor.preview(
                        writePath(
                            state,
                            path,
                            insertVertex(
                                readPath(state, path),
                                midpoint.afterIndex,
                                midpoint.point,
                            ),
                        ),
                    )
                    selectVertex(path, index)
                },
                onTap: () => insertMidpoint(path, midpoint),
            },
        )
    }

    function dragSelection(
        event: PointerEvent,
        apply: (start: EditorState, dx: number, dy: number) => EditorState,
    ) {
        if (event.button !== 0 || editor.tool.value !== 'select') return
        event.stopPropagation()
        const start = editor.state.value
        const origin = panZoom.toMap({ x: event.clientX, y: event.clientY })
        trackDrag(event, (move) => {
            const point = panZoom.toMap({ x: move.clientX, y: move.clientY })
            const dx = snapPoint([point[0] - origin[0], 0], options.grid())[0]
            const dy = snapPoint([0, point[1] - origin[1]], options.grid())[1]
            editor.preview(apply(start, dx, dy))
        })
    }

    function withTrace(patch: (trace: MapTrace) => Partial<MapTrace>) {
        const state = editor.state.value
        const trace = state.map.trace
        if (!trace) return
        editor.preview({
            ...state,
            map: { ...state.map, trace: { ...trace, ...patch(trace) } },
        })
    }

    function onTraceDown(event: PointerEvent) {
        const start = editor.state.value.map.trace
        if (event.button !== 0 || !start) return
        const origin = panZoom.toMap({ x: event.clientX, y: event.clientY })
        trackDrag(event, (move) => {
            const point = panZoom.toMap({ x: move.clientX, y: move.clientY })
            withTrace(() => ({
                x: roundToCm(
                    snapPoint(
                        [start.x + point[0] - origin[0], 0],
                        options.grid(),
                    )[0],
                ),
                y: roundToCm(
                    snapPoint(
                        [0, start.y + point[1] - origin[1]],
                        options.grid(),
                    )[1],
                ),
            }))
        })
    }

    function onTraceScaleDown(event: PointerEvent) {
        if (event.button !== 0) return
        trackDrag(event, (move) => {
            const point = panZoom.toMap({ x: move.clientX, y: move.clientY })
            withTrace((trace) => ({
                width: roundToCm(Math.max(0.5, point[0] - trace.x)),
            }))
        })
    }

    function onMoveDown(event: PointerEvent) {
        const selection = editor.selection.value
        if (selection?.kind === 'shape') {
            const index = selection.index
            dragSelection(event, (start, dx, dy) =>
                writePath(
                    start,
                    { type: 'shape', index },
                    translatePoints(
                        start.map.shapes[index]!.points,
                        dx,
                        dy,
                        start.map,
                    ),
                ),
            )
        } else if (selection?.kind === 'wall') {
            const key = selection.key
            dragSelection(event, (start, dx, dy) => {
                const original = start.walls.find((item) => item.key === key)!
                const all = [
                    ...original.outline,
                    ...original.edge,
                    ...(original.label ? [original.label] : []),
                ]
                const moved = translatePoints(all, dx, dy, start.map)
                const [safeDx, safeDy] = all.length
                    ? [moved[0]![0] - all[0]![0], moved[0]![1] - all[0]![1]]
                    : [0, 0]
                const shift = (points: MapPoint[]) =>
                    translatePoints(points, safeDx, safeDy, start.map)
                return updateWall(start, key, {
                    outline: shift(original.outline),
                    edge: shift(original.edge),
                    label: original.label ? shift([original.label])[0]! : null,
                })
            })
        }
    }

    function onLabelDown(wall: EditorWall, event: PointerEvent) {
        if (
            event.button !== 0 ||
            editor.tool.value !== 'select' ||
            !(
                editor.selection.value?.kind === 'wall' &&
                editor.selection.value.key === wall.key
            )
        )
            return
        event.stopPropagation()
        trackDrag(event, (move) => {
            editor.preview(
                updateWall(editor.state.value, wall.key, {
                    label: snapped(move),
                }),
            )
        })
    }

    return {
        snapped,
        selectVertex,
        insertMidpoint,
        onVertexDown,
        onMidpointDown,
        onTraceDown,
        onTraceScaleDown,
        onMoveDown,
        onLabelDown,
    }
}
