import { describe, expect, it } from 'vitest'
import {
    autoDistribute,
    fitViewBox,
    freePosition,
    insertByAnchor,
    hasAnchorRange,
    wallForAnchor,
    labelPoint,
    nearestWall,
    pointAt,
    pointInPolygon,
    polylineLength,
    projectOntoPolyline,
    sanitizeGymMap,
    sanitizeWall,
    shapeMinPoints,
    snapPoint,
    type GymMap,
    type MapPoint,
} from '#shared/utils/mapGeometry'

const edge: MapPoint[] = [
    [0, 0],
    [10, 0],
    [10, 10],
]
const map: GymMap = { width: 40, height: 30, shapes: [] }

describe('polylines', () => {
    it('measures and walks along an edge', () => {
        expect(polylineLength(edge)).toBe(20)
        expect(pointAt(edge, 0)).toEqual([0, 0])
        expect(pointAt(edge, 0.25)).toEqual([5, 0])
        expect(pointAt(edge, 0.75)).toEqual([10, 5])
        expect(pointAt(edge, 2)).toEqual([10, 10])
        expect(pointAt([], 0.5)).toEqual([0, 0])
    })

    it('projects a point onto the closest segment', () => {
        const projection = projectOntoPolyline(edge, [12, 5])!
        expect(projection.position).toBeCloseTo(0.75)
        expect(projection.distance).toBeCloseTo(2)
        expect(projection.point).toEqual([10, 5])
        expect(
            projectOntoPolyline(
                [
                    [1, 1],
                    [1, 1],
                ],
                [0, 0],
            ),
        ).toBeNull()
    })

    it('snaps to the nearest wall within reach', () => {
        const walls = [
            { id: 'a', edge },
            {
                id: 'b',
                edge: [
                    [0, 20],
                    [10, 20],
                ] as MapPoint[],
            },
        ]
        expect(nearestWall(walls, [5, 18], 3)?.wall.id).toBe('b')
        expect(nearestWall(walls, [5, 18], 3)?.position).toBeCloseTo(0.5)
        expect(nearestWall(walls, [25, 25], 3)).toBeNull()
    })
})

describe('polygons', () => {
    const lShape: MapPoint[] = [
        [0, 0],
        [10, 0],
        [10, 2],
        [2, 2],
        [2, 10],
        [0, 10],
    ]

    it('detects points inside', () => {
        expect(pointInPolygon([1, 5], lShape)).toBe(true)
        expect(pointInPolygon([5, 5], lShape)).toBe(false)
    })

    it('centres labels on long thin walls', () => {
        const strip: MapPoint[] = [
            [0, 0],
            [20, 0],
            [20, 2],
            [0, 2],
        ]
        expect(labelPoint(strip)).toEqual([10, 1])
    })

    it('places labels inside concave shapes', () => {
        expect(pointInPolygon(labelPoint(lShape), lShape)).toBe(true)
    })
})

describe('view boxes and grid', () => {
    it('fits bounds into the screen aspect ratio with padding', () => {
        const box = fitViewBox({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 2, 1)
        expect(box).toEqual({ x: -7, y: -1, width: 24, height: 12 })
    })

    it('snaps to the grid in centimetres', () => {
        expect(snapPoint([1.26, 3.74], 0.5)).toEqual([1.5, 3.5])
        expect(snapPoint([1.234, 3.001], 0)).toEqual([1.23, 3])
    })
})

describe('sanitizing stored JSON', () => {
    it('keeps valid shapes and drops broken ones', () => {
        const sanitized = sanitizeGymMap({
            width: 40,
            height: 30,
            shapes: [
                {
                    kind: 'floor',
                    points: [
                        [0, 0],
                        [40, 0],
                        [40, 30],
                    ],
                },
                {
                    kind: 'lava',
                    points: [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                    ],
                },
                {
                    kind: 'mat',
                    points: [
                        [0, 0],
                        [99, 0],
                        [1, 1],
                    ],
                },
                {
                    kind: 'mat',
                    points: [
                        [0, 0],
                        ['1', 0],
                        [1, 1],
                    ],
                },
            ],
            trace: { x: 0, y: 0, width: 40, opacity: 3 },
        })
        expect(sanitized?.shapes).toHaveLength(1)
        expect(sanitized?.trace?.opacity).toBe(1)
    })

    it('rejects maps with an invalid size', () => {
        expect(sanitizeGymMap(null)).toBeNull()
        expect(sanitizeGymMap({ width: 2, height: 30, shapes: [] })).toBeNull()
        expect(sanitizeGymMap({ width: 40, height: 30 })).toBeNull()
    })

    it('validates wall geometry against the map', () => {
        const outline = [
            [1, 1],
            [5, 1],
            [5, 2],
        ]
        expect(
            sanitizeWall(
                {
                    outline,
                    edge: [
                        [1, 1],
                        [5, 1],
                    ],
                    label: [3, 1.5],
                },
                map,
            ),
        ).toEqual({
            outline,
            edge: [
                [1, 1],
                [5, 1],
            ],
            label: [3, 1.5],
        })
        expect(
            sanitizeWall(
                {
                    outline,
                    edge: [
                        [1, 1],
                        [1, 1],
                    ],
                },
                map,
            ),
        ).toBeNull()
        expect(
            sanitizeWall(
                {
                    outline,
                    edge: [
                        [1, 1],
                        [50, 1],
                    ],
                },
                map,
            ),
        ).toBeNull()
        expect(
            sanitizeWall(
                {
                    outline,
                    edge: [
                        [1, 1],
                        [5, 1],
                    ],
                    label: 'x',
                },
                map,
            )?.label,
        ).toBeNull()
    })
})

describe('autoDistribute', () => {
    it('spreads routes evenly in anchor order, unanchored last', () => {
        const positions = autoDistribute([
            { id: 'c', name: 'C' },
            { id: 'b', anchor_point: 2, name: 'B' },
            { id: 'a', anchor_point: 1, name: 'A' },
            { id: 'd', name: 'D' },
        ])
        expect([...positions]).toEqual([
            ['a', 0.13],
            ['b', 0.38],
            ['c', 0.63],
            ['d', 0.88],
        ])
    })
})

describe('freePosition', () => {
    it('picks the middle of the largest gap on the wall', () => {
        expect(freePosition([])).toBe(0.5)
        expect(freePosition([0.5])).toBe(0.25)
        expect(freePosition([0.1, 0.2, 0.9])).toBe(0.55)
    })
})

describe('wallForAnchor', () => {
    const walls = [
        { id: 'a', anchor_from: 1, anchor_to: 10 },
        { id: 'b', anchor_from: 20, anchor_to: 11 },
        { id: 'c', anchor_from: null, anchor_to: null },
    ]

    it('finds the wall whose range covers the anchor', () => {
        expect(wallForAnchor(walls, 1)).toBe('a')
        expect(wallForAnchor(walls, 15)).toBe('b')
    })

    it('returns null without an anchor, a match or with overlaps', () => {
        expect(wallForAnchor(walls, null)).toBeNull()
        expect(wallForAnchor(walls, 99)).toBeNull()
        expect(
            wallForAnchor(
                [...walls, { id: 'd', anchor_from: 5, anchor_to: 6 }],
                5,
            ),
        ).toBeNull()
    })
})

describe('insertByAnchor', () => {
    it('spreads routes evenly on an empty wall in anchor order', () => {
        const positions = insertByAnchor(
            [],
            [
                { id: 'y', anchor_point: 2 },
                { id: 'x', anchor_point: 1 },
                { id: 'z', anchor_point: 3 },
            ],
        )
        expect(positions.get('x')).toBe(0.25)
        expect(positions.get('y')).toBe(0.5)
        expect(positions.get('z')).toBe(0.75)
    })

    it('fits new routes between placed neighbours by anchor', () => {
        const placed = [
            { id: 'p1', anchor_point: 2, wall_position: 0.2 },
            { id: 'p5', anchor_point: 6, wall_position: 0.6 },
        ]
        const positions = insertByAnchor(placed, [
            { id: 'n3', anchor_point: 3 },
            { id: 'n9', anchor_point: 9 },
            { id: 'n0', anchor_point: 1 },
        ])
        expect(positions.get('n3')).toBe(0.4)
        expect(positions.get('n9')).toBe(0.8)
        expect(positions.get('n0')).toBe(0.1)
    })
})

describe('unset anchors', () => {
    it('treats 0 as no range and no anchor', () => {
        const walls = [
            { id: 'unset', anchor_from: 0, anchor_to: 0 },
            { id: 'ranged', anchor_from: 1, anchor_to: 10 },
        ]
        expect(hasAnchorRange(walls[0]!)).toBe(false)
        expect(wallForAnchor(walls, 0)).toBeNull()
        expect(wallForAnchor(walls, '')).toBeNull()
        expect(wallForAnchor(walls, 5)).toBe('ranged')
    })

    it('ignores anchor 0 routes as neighbours', () => {
        const positions = insertByAnchor(
            [{ id: 'boulder', anchor_point: 0, wall_position: 0.9 }],
            [{ id: 'n', anchor_point: 4 }],
        )
        expect(positions.get('n')).toBe(0.5)
    })
})

describe('descending ranges', () => {
    it('mirrors positions when anchors count down the wall', () => {
        const positions = insertByAnchor(
            [],
            [
                { id: 'low', anchor_point: 11 },
                { id: 'high', anchor_point: 12 },
            ],
            true,
        )
        expect(positions.get('low')).toBeGreaterThan(positions.get('high')!)
    })

    it('fits between neighbours on a descending wall', () => {
        const positions = insertByAnchor(
            [
                { id: 'a18', anchor_point: 18, wall_position: 0.2 },
                { id: 'a12', anchor_point: 12, wall_position: 0.8 },
            ],
            [{ id: 'a15', anchor_point: 15 }],
            true,
        )
        expect(positions.get('a15')).toBe(0.5)
    })
})

describe('map shape kinds', () => {
    it('keeps open lines with two points, levels 2–3 and drops the rest', () => {
        const map = sanitizeGymMap({
            width: 10,
            height: 10,
            shapes: [
                {
                    kind: 'line',
                    points: [
                        [1, 1],
                        [4, 1],
                    ],
                },
                {
                    kind: 'path',
                    points: [
                        [1, 1],
                        [4, 1],
                    ],
                },
                {
                    kind: 'entrance',
                    points: [
                        [0, 0],
                        [2, 0],
                        [2, 1],
                    ],
                },
                {
                    kind: 'structure',
                    points: [
                        [0, 0],
                        [2, 0],
                        [2, 2],
                    ],
                    level: 3,
                },
                {
                    kind: 'structure',
                    points: [
                        [0, 0],
                        [2, 0],
                        [2, 2],
                    ],
                    level: 1,
                },
                {
                    kind: 'structure',
                    points: [
                        [0, 0],
                        [2, 0],
                        [2, 2],
                    ],
                    level: 9,
                },
            ],
        })!
        expect(map.shapes.map((shape) => [shape.kind, shape.level])).toEqual([
            ['line', undefined],
            ['entrance', undefined],
            ['structure', 3],
            ['structure', undefined],
            ['structure', undefined],
        ])
        expect(shapeMinPoints('line')).toBe(2)
        expect(shapeMinPoints('path')).toBe(3)
    })
})
