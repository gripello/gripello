import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useMapPlacement } from '~/composables/useMapPlacement'
import type { RouteRecord, WallRecord } from '~/types/models'
import type { MapWall } from '~/utils/gymMap'

const wall = (id: string, extra: Partial<WallRecord> = {}) =>
    ({ id, name: id, location: 'hall', ...extra }) as WallRecord

const mapWall = (id: string) =>
    ({
        id,
        name: id,
        sort: 0,
        outline: [],
        edge: [],
        labelAt: [0, 0],
    }) as unknown as MapWall

const route = (id: string, extra: Partial<RouteRecord> = {}) =>
    ({
        id,
        name: id,
        color: '#e53935',
        grade: '6',
        type: 'Boulder',
        wall: null,
        wall_position: null,
        ...extra,
    }) as RouteRecord

function setup(routes: RouteRecord[], walls = [wall('north')]) {
    return useMapPlacement(
        ref(routes),
        ref(walls),
        ref(walls.map((record) => mapWall(record.id))),
    )
}

describe('useMapPlacement', () => {
    it('arms the next unplaced route after placing one', () => {
        const placement = setup([route('a'), route('b'), route('c')])
        placement.arm('a')
        placement.place('a', 'north', 0.3)

        expect(placement.armedRouteId.value).toBe('b')
        expect(placement.changes.value).toHaveLength(1)
        expect(placement.unplacedRoutes.value.map((item) => item.id)).toEqual([
            'b',
            'c',
        ])
    })

    it('leaves permanent routes out of the wall age', () => {
        const daysAgo = (days: number) =>
            new Date(Date.now() - days * 86_400_000).toISOString()
        const placement = setup([
            route('a', {
                wall: 'north',
                wall_position: 0.2,
                screw_date: daysAgo(10),
            }),
            route('b', {
                wall: 'north',
                wall_position: 0.4,
                screw_date: daysAgo(30),
            }),
            route('c', {
                wall: 'north',
                wall_position: 0.6,
                screw_date: daysAgo(7000),
                permanent: true,
            }),
        ])
        placement.selectedWallId.value = 'north'

        expect(placement.wallAge.value).toEqual({ oldest: 30, average: 20 })
    })

    it('stops after one route when keep going is off', () => {
        const placement = setup([route('a'), route('b')])
        placement.keepGoing.value = false
        placement.arm('a')
        placement.place('a', 'north', 0.3)
        expect(placement.armedRouteId.value).toBeNull()
    })

    it('undoes, nudges and removes placements', () => {
        const placement = setup([
            route('a', { wall: 'north', wall_position: 0.5 }),
        ])
        placement.selectedRouteId.value = 'a'
        placement.nudge(1)
        expect(placement.findRoute('a')?.wall_position).toBeCloseTo(0.52)

        placement.undo()
        expect(placement.changes.value).toHaveLength(0)

        placement.unplace('a')
        expect(placement.placedRoutes.value).toHaveLength(0)
        expect(placement.selectedRouteId.value).toBeNull()

        placement.reset()
        expect(placement.history.value).toHaveLength(0)
        expect(placement.placedRoutes.value).toHaveLength(1)
    })

    it('places ticked routes on a wall ordered by anchor', () => {
        const placement = setup([
            route('high', { anchor_point: 9 }),
            route('low', { anchor_point: 2 }),
        ])
        placement.toggleChecked('high')
        placement.toggleChecked('low')
        placement.place('high', 'north', 0.9)

        const low = placement.findRoute('low')!.wall_position!
        const high = placement.findRoute('high')!.wall_position!
        expect(low).toBeLessThan(high)
        expect(placement.checkedIds.value.size).toBe(0)
        expect(placement.selectedWallId.value).toBe('north')
    })

    it('auto-places routes whose anchor falls in a wall range', () => {
        const placement = setup(
            [
                route('in', { anchor_point: 3 }),
                route('out', { anchor_point: 30 }),
            ],
            [wall('north', { anchor_from: 1, anchor_to: 10 })],
        )
        expect([...placement.autoPlacements.value.keys()]).toEqual(['in'])
        placement.autoPlace()
        expect(placement.unplacedRoutes.value.map((item) => item.id)).toEqual([
            'out',
        ])
    })

    it('filters the list by type, grade, colour and name', () => {
        const placement = setup([
            route('Slab', { type: 'Boulder' }),
            route('Roof', { type: 'Route', grade: '7', color: '#1e88e5' }),
        ])
        placement.typeFilter.value = 'Route'
        expect(placement.listedRoutes.value.map((item) => item.id)).toEqual([
            'Roof',
        ])
        placement.clearFilters()
        placement.gradeFilter.value = '6'
        expect(placement.listedRoutes.value.map((item) => item.id)).toEqual([
            'Slab',
        ])
        placement.clearFilters()
        placement.search.value = 'ro'
        expect(placement.activeFilterCount.value).toBe(1)
        expect(placement.listedRoutes.value.map((item) => item.id)).toEqual([
            'Roof',
        ])
    })
})
