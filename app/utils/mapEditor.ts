import { apiFieldErrors } from './fieldErrors'
import {
    boundsOf,
    distance,
    isOpenShape,
    MAP_LIMITS,
    shapeMinPoints,
    polylineLength,
    roundToCm,
    type GymMap,
    type MapBounds,
    type MapPoint,
    type MapShapeKind,
} from '#shared/utils/mapGeometry'

export interface EditorWall {
    key: string
    id?: string
    name: string
    outline: MapPoint[]
    edge: MapPoint[]
    label: MapPoint | null
    sort: number
    anchorFrom: number | null
    anchorTo: number | null
}

export const SHAPE_ICONS: Record<MapShapeKind, string> = {
    floor: 'i-lucide-land-plot',
    path: 'i-lucide-footprints',
    entrance: 'i-lucide-door-open',
    mat: 'i-lucide-rectangle-horizontal',
    structure: 'i-lucide-box',
    line: 'i-lucide-slash',
}

export type TraceChange = { file: string } | { removed: true }

export interface EditorState {
    map: GymMap
    walls: EditorWall[]
    trace?: TraceChange
}

export type EditorPath =
    | { type: 'shape'; index: number }
    | { type: 'outline'; key: string }
    | { type: 'edge'; key: string }

export type EditorTool =
    'select' | 'shape' | 'outline' | 'edge' | 'label' | 'trace'

export interface WallChanges {
    create: EditorWall[]
    update: EditorWall[]
    remove: string[]
}

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value))

export function newFloorPlan(width: number, height: number): GymMap {
    return {
        width,
        height,
        shapes: [
            {
                kind: 'floor',
                points: [
                    [0, 0],
                    [width, 0],
                    [width, height],
                    [0, height],
                ],
            },
        ],
    }
}

export function readPath(state: EditorState, path: EditorPath): MapPoint[] {
    if (path.type === 'shape') return state.map.shapes[path.index]?.points ?? []
    const wall = state.walls.find((candidate) => candidate.key === path.key)
    if (!wall) return []
    return path.type === 'outline' ? wall.outline : wall.edge
}

export function writePath(
    state: EditorState,
    path: EditorPath,
    points: MapPoint[],
): EditorState {
    if (path.type === 'shape') {
        return {
            ...state,
            map: {
                ...state.map,
                shapes: state.map.shapes.map((shape, index) =>
                    index === path.index ? { ...shape, points } : shape,
                ),
            },
        }
    }
    return updateWall(state, path.key, { [path.type]: points })
}

export function minPointsFor(state: EditorState, path: EditorPath): number {
    if (path.type === 'edge') return MAP_LIMITS.edgeMinPoints
    if (path.type === 'outline') return MAP_LIMITS.shapeMinPoints
    const kind = state.map.shapes[path.index]?.kind
    return kind ? shapeMinPoints(kind) : MAP_LIMITS.shapeMinPoints
}

export function isOpenPath(state: EditorState, path: EditorPath): boolean {
    if (path.type === 'edge') return true
    if (path.type === 'outline') return false
    const kind = state.map.shapes[path.index]?.kind
    return !!kind && isOpenShape(kind)
}

export function addShape(
    state: EditorState,
    kind: MapShapeKind,
    points: MapPoint[],
): EditorState {
    return {
        ...state,
        map: { ...state.map, shapes: [...state.map.shapes, { kind, points }] },
    }
}

export function setShapeKind(
    state: EditorState,
    index: number,
    kind: MapShapeKind,
): EditorState {
    const shape = state.map.shapes[index]
    if (!shape || shape.points.length < shapeMinPoints(kind)) return state
    return updateShape(state, index, { kind })
}

export function setShapeLevel(
    state: EditorState,
    index: number,
    level: number,
): EditorState {
    const shape = state.map.shapes[index]
    if (!shape) return state
    const { level: _previous, ...rest } = shape
    return updateShape(
        state,
        index,
        level > 1 ? { ...rest, level } : rest,
        true,
    )
}

function updateShape(
    state: EditorState,
    index: number,
    patch: Partial<GymMap['shapes'][number]>,
    replace = false,
): EditorState {
    return {
        ...state,
        map: {
            ...state.map,
            shapes: state.map.shapes.map((shape, shapeIndex) =>
                shapeIndex !== index
                    ? shape
                    : replace
                      ? (patch as GymMap['shapes'][number])
                      : { ...shape, ...patch },
            ),
        },
    }
}

export function removeShape(state: EditorState, index: number): EditorState {
    return {
        ...state,
        map: {
            ...state.map,
            shapes: state.map.shapes.filter(
                (_, shapeIndex) => shapeIndex !== index,
            ),
        },
    }
}

export function addWall(
    state: EditorState,
    key: string,
    name: string,
): EditorState {
    const sort = Math.max(0, ...state.walls.map((wall) => wall.sort)) + 1
    return {
        ...state,
        walls: [
            ...state.walls,
            {
                key,
                name,
                outline: [],
                edge: [],
                label: null,
                sort,
                anchorFrom: null,
                anchorTo: null,
            },
        ],
    }
}

export function nextWallName(
    walls: EditorWall[],
    format: (n: number) => string,
): string {
    const taken = new Set(walls.map((wall) => wall.name.trim().toLowerCase()))
    let n = walls.length + 1
    while (taken.has(format(n).toLowerCase())) n++
    return format(n)
}

export function updateWall(
    state: EditorState,
    key: string,
    patch: Partial<Omit<EditorWall, 'key' | 'id'>>,
): EditorState {
    return {
        ...state,
        walls: state.walls.map((wall) =>
            wall.key === key ? { ...wall, ...patch } : wall,
        ),
    }
}

export function removeWall(state: EditorState, key: string): EditorState {
    return { ...state, walls: state.walls.filter((wall) => wall.key !== key) }
}

export function moveWall(
    state: EditorState,
    key: string,
    direction: -1 | 1,
): EditorState {
    const ordered = [...state.walls].sort((a, b) => a.sort - b.sort)
    const index = ordered.findIndex((wall) => wall.key === key)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ordered.length) return state
    ;[ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]
    return {
        ...state,
        walls: ordered.map((wall, position) => ({
            ...wall,
            sort: position + 1,
        })),
    }
}

export function moveVertex(
    points: MapPoint[],
    index: number,
    point: MapPoint,
): MapPoint[] {
    return points.map((current, pointIndex) =>
        pointIndex === index ? point : current,
    )
}

export function insertVertex(
    points: MapPoint[],
    afterIndex: number,
    point: MapPoint,
): MapPoint[] {
    return [
        ...points.slice(0, afterIndex + 1),
        point,
        ...points.slice(afterIndex + 1),
    ]
}

export function removeVertex(
    points: MapPoint[],
    index: number,
    minPoints: number,
): MapPoint[] | null {
    if (points.length <= minPoints) return null
    return points.filter((_, pointIndex) => pointIndex !== index)
}

export function midpoints(
    points: MapPoint[],
    closed: boolean,
): { afterIndex: number; point: MapPoint }[] {
    const segments = closed ? points.length : points.length - 1
    return Array.from({ length: Math.max(0, segments) }, (_, index) => {
        const start = points[index]!
        const end = points[(index + 1) % points.length]!
        return {
            afterIndex: index,
            point: [
                roundToCm((start[0] + end[0]) / 2),
                roundToCm((start[1] + end[1]) / 2),
            ] as MapPoint,
        }
    })
}

export function translatePoints(
    points: MapPoint[],
    dx: number,
    dy: number,
    map: GymMap,
): MapPoint[] {
    const bounds = boundsOf(points)
    if (!bounds) return points
    const safeDx = Math.min(map.width - bounds.maxX, Math.max(-bounds.minX, dx))
    const safeDy = Math.min(
        map.height - bounds.maxY,
        Math.max(-bounds.minY, dy),
    )
    return points.map(([x, y]) => [
        roundToCm(x + safeDx),
        roundToCm(y + safeDy),
    ])
}

export function clampToMap(point: MapPoint, map: GymMap): MapPoint {
    return [
        roundToCm(clamp(point[0], map.width)),
        roundToCm(clamp(point[1], map.height)),
    ]
}

export function snapToVertices(
    point: MapPoint,
    candidates: MapPoint[],
    tolerance: number,
): MapPoint | null {
    let best: MapPoint | null = null
    let bestDistance = tolerance
    for (const candidate of candidates) {
        const gap = distance(point, candidate)
        if (gap <= bestDistance) {
            best = candidate
            bestDistance = gap
        }
    }
    return best
}

export function withoutRepeats(points: MapPoint[]): MapPoint[] {
    return points.filter(
        (point, index) =>
            index === 0 ||
            point[0] !== points[index - 1]![0] ||
            point[1] !== points[index - 1]![1],
    )
}

export const TRACE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/webp',
]
export const TRACE_MAX_BYTES = 10 * 1024 * 1024

export function stageTrace(state: EditorState, file: string): EditorState {
    const { map } = state
    return {
        ...state,
        trace: { file },
        map: {
            ...map,
            trace: map.trace ?? { x: 0, y: 0, width: map.width, opacity: 0.5 },
        },
    }
}

export function dropTrace(state: EditorState): EditorState {
    const { trace: _placement, ...map } = state.map
    return { ...state, map, trace: { removed: true } }
}

export function contentBounds(state: EditorState): MapBounds | null {
    return boundsOf([
        ...state.map.shapes.flatMap((shape) => shape.points),
        ...state.walls.flatMap((wall) => [
            ...wall.outline,
            ...wall.edge,
            ...(wall.label ? [wall.label] : []),
        ]),
    ])
}

export function canResize(
    state: EditorState,
    width: number,
    height: number,
): boolean {
    if (
        width < MAP_LIMITS.minSize ||
        height < MAP_LIMITS.minSize ||
        width > MAP_LIMITS.maxSize ||
        height > MAP_LIMITS.maxSize
    )
        return false
    const bounds = contentBounds(state)
    return !bounds || (bounds.maxX <= width && bounds.maxY <= height)
}

export type WallProblem = 'name' | 'duplicate' | 'outline' | 'edge'

const nameKey = (wall: EditorWall) => wall.name.trim().toLowerCase()

export function wallProblems(
    wall: EditorWall,
    walls: EditorWall[] = [],
): WallProblem[] {
    const problems: WallProblem[] = []
    if (!wall.name.trim()) problems.push('name')
    else if (
        walls.some(
            (other) =>
                other.key !== wall.key && nameKey(other) === nameKey(wall),
        )
    )
        problems.push('duplicate')
    if (wall.outline.length < MAP_LIMITS.shapeMinPoints)
        problems.push('outline')
    if (
        wall.edge.length < MAP_LIMITS.edgeMinPoints ||
        polylineLength(wall.edge) === 0
    )
        problems.push('edge')
    return problems
}

export interface FloorPlanError {
    key: string | null
    name: string
    code: string
    message: string
}

const ERROR_KEY = /^(walls|removed)\.(\d+)(?:\.|$)/

export function floorPlanErrors(
    error: unknown,
    sent: { walls: EditorWall[]; removed: EditorWall[] },
): FloorPlanError[] {
    return Object.entries(apiFieldErrors(error)).flatMap(([field, detail]) => {
        const match = ERROR_KEY.exec(field)
        if (!match) return []
        const list = match[1] === 'walls' ? sent.walls : sent.removed
        const wall = list[Number(match[2])]
        if (!wall) return []
        return [
            {
                key: match[1] === 'walls' ? wall.key : null,
                name: wall.name,
                code: detail.code ?? '',
                message: detail.message ?? '',
            },
        ]
    })
}

export function wallChanges(
    saved: EditorWall[],
    current: EditorWall[],
): WallChanges {
    const savedById = new Map(
        saved.filter((wall) => wall.id).map((wall) => [wall.id!, wall]),
    )
    const currentIds = new Set(current.map((wall) => wall.id).filter(Boolean))
    return {
        create: current.filter((wall) => !wall.id),
        update: current.filter((wall) => {
            const before = wall.id ? savedById.get(wall.id) : undefined
            return before && JSON.stringify(before) !== JSON.stringify(wall)
        }),
        remove: [...savedById.keys()].filter((id) => !currentIds.has(id)),
    }
}
