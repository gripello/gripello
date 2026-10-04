import { describe, expect, it } from 'vitest'
import {
    applyPlacements,
    clearOfDots,
    dotColors,
    isNewRoute,
    placeRoutes,
    placementChanges,
    routesOnWall,
    toMapWalls,
    visibleLabels,
    wallCounts,
} from '~/utils/gymMap'

const map = { width: 40, height: 30, shapes: [] }
const walls = toMapWalls(
    [
        {
            id: 'b',
            name: 'Island',
            sort: 2,
            outline: [
                [10, 10],
                [20, 10],
                [20, 20],
            ],
            edge: [
                [10, 10],
                [20, 10],
            ],
        },
        {
            id: 'a',
            name: 'North',
            sort: 1,
            outline: [
                [0, 0],
                [10, 0],
                [10, 2],
            ],
            edge: [
                [0, 0],
                [10, 0],
            ],
            label: [5, 1],
        },
        { id: 'broken', name: 'Broken', outline: [], edge: [] },
    ],
    map,
)

const routes = [
    {
        id: 'r1',
        name: 'One',
        color: '#ffffff',
        grade: ' 6A+ ',
        wall: 'a',
        wall_position: 0.8,
    },
    { id: 'r2', name: 'Two', color: 'nonsense', wall: 'a', wall_position: 0.2 },
    {
        id: 'r3',
        name: 'Three',
        color: '#000000',
        wall: 'b',
        wall_position: 0.5,
    },
    { id: 'r4', name: 'Loose', color: '#123456', wall: null },
]

describe('toMapWalls', () => {
    it('keeps valid walls in display order with a label position', () => {
        expect(walls.map((wall) => wall.id)).toEqual(['a', 'b'])
        expect(walls[0]!.labelAt).toEqual([5, 1])
        expect(walls[1]!.labelAt[0]).toBeGreaterThan(10)
    })
})

describe('placeRoutes', () => {
    it('puts each route on its wall edge with readable colours', () => {
        const dots = placeRoutes(walls, routes)
        expect(dots.map((dot) => dot.routeId)).toEqual(['r1', 'r2', 'r3'])
        expect(dots[0]!.point).toEqual([8, 0])
        expect(dots[0]!.stroke).toBe('#1A1A1A')
        expect(dots[1]!.fill).toBe('#9E9E9E')
        expect(dots[2]!.stroke).toBe('#FFFFFF')
        expect(dots.map((dot) => dot.grade)).toEqual(['6A+', '', ''])
    })

    it('flags routes set within the last week', () => {
        const now = new Date('2026-09-27T12:00:00Z')
        expect(isNewRoute('2026-09-25 10:00:00.000Z', now)).toBe(true)
        expect(isNewRoute('2026-09-01 10:00:00.000Z', now)).toBe(false)
        expect(isNewRoute(null, now)).toBe(false)
    })
})

describe('wallCounts', () => {
    it('counts sent and total per wall, respecting the filter', () => {
        const all = wallCounts(routes, new Set(['r1']), null)
        expect(all.get('a')).toEqual({ total: 2, sent: 1 })
        expect(all.get('b')).toEqual({ total: 1, sent: 0 })
        const filtered = wallCounts(routes, new Set(['r1']), new Set(['r2']))
        expect(filtered.get('a')).toEqual({ total: 1, sent: 0 })
        expect(filtered.has('b')).toBe(false)
    })
})

describe('routesOnWall', () => {
    it('orders routes along the wall', () => {
        expect(routesOnWall(routes, 'a').map((route) => route.id)).toEqual([
            'r2',
            'r1',
        ])
    })
})

describe('dotColors', () => {
    it('normalizes hex colours', () => {
        expect(dotColors('#e53935').fill).toBe('#E53935')
    })
})

describe('visibleLabels', () => {
    it('hides labels that collide, keeping the selected one', () => {
        const boxes = [
            { id: 'a', x: 0, y: 0, width: 100, height: 40 },
            { id: 'b', x: 50, y: 10, width: 100, height: 40 },
            { id: 'c', x: 300, y: 0, width: 100, height: 40 },
        ]
        expect([...visibleLabels(boxes, null)]).toEqual(['a', 'c'])
        expect([...visibleLabels(boxes, 'b')]).toEqual(['b', 'c'])
    })
})

describe('pending placements', () => {
    const pending = new Map([
        ['r1', { wall: 'b', position: 0.3 }],
        ['r2', { wall: 'a', position: 0.2 }],
        ['r4', { wall: null, position: null }],
    ])

    it('overlays unsaved placements on the routes', () => {
        const effective = applyPlacements(routes, pending)
        expect(effective[0]).toMatchObject({ wall: 'b', wall_position: 0.3 })
        expect(effective[2]).toBe(routes[2])
    })

    it('only reports placements that differ from what is stored', () => {
        expect(placementChanges(routes, pending)).toEqual([
            { id: 'r1', wall: 'b', wall_position: 0.3 },
        ])
        expect(
            placementChanges(
                routes,
                new Map([['r3', { wall: null, position: null }]]),
            ),
        ).toEqual([{ id: 'r3', wall: '', wall_position: null }])
    })
})

describe('clearOfDots', () => {
    const label = { id: 'w', x: 100, y: 100, width: 80, height: 40 }

    it('keeps the label where it is when no dot is underneath', () => {
        expect(clearOfDots(label, [{ x: 300, y: 100 }], 6, 8)).toEqual(label)
    })

    it('moves the label above a covered dot', () => {
        expect(clearOfDots(label, [{ x: 100, y: 105 }], 6, 8).y).toBe(72)
    })

    it('moves the label below a covered dot when told to', () => {
        expect(clearOfDots(label, [{ x: 100, y: 95 }], 6, 8, 1).y).toBe(128)
    })

    it('tries further out when the next spots are taken too', () => {
        const dots = [
            { x: 100, y: 105 },
            { x: 100, y: 72 },
        ]
        expect(clearOfDots(label, dots, 6, 8).y).toBe(44)
    })
})
