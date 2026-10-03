import PocketBase from 'pocketbase'
import { expect, type Locator, type Page } from '@playwright/test'
import { e2eGymId, uiaa } from './seed'

export const PB_URL = process.env.E2E_PB_URL || 'https://localhost'

export const TEST_MAP = {
    width: 40,
    height: 30,
    shapes: [
        {
            kind: 'floor',
            points: [
                [0, 0],
                [40, 0],
                [40, 30],
                [0, 30],
            ],
        },
    ],
}

const NORTH_WALL = {
    outline: [
        [2, 2],
        [38, 2],
        [38, 5],
        [2, 5],
    ],
    edge: [
        [2, 5],
        [38, 5],
    ],
}

const ISLAND_WALL = {
    outline: [
        [15, 15],
        [25, 15],
        [25, 22],
        [15, 22],
    ],
    edge: [
        [15, 15],
        [25, 15],
        [25, 22],
    ],
}

export interface SeededMap {
    root: PocketBase
    locationId: string
    northWallId: string
    islandWallId: string
    routeIds: string[]
    cleanup: () => Promise<void>
}

export async function seedMap(
    root: PocketBase,
    prefix: string,
    { routes = 3 }: { routes?: number } = {},
): Promise<SeededMap> {
    const location = await root.collection('locations').create({
        gym: await e2eGymId(root),
        name: `${prefix} Map Hall`,
        map: TEST_MAP,
    })
    const north = await root.collection('walls').create({
        location: location.id,
        name: `${prefix} North`,
        sort: 1,
        ...NORTH_WALL,
    })
    const island = await root.collection('walls').create({
        location: location.id,
        name: `${prefix} Island`,
        sort: 2,
        ...ISLAND_WALL,
    })
    const colors = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa']
    const routeIds: string[] = []
    for (let index = 0; index < routes; index++) {
        const route = await root.collection('routes').create({
            name: `${prefix}-map-route-${index + 1}`,
            ...uiaa(index % 2 ? '6' : '5'),
            location: location.id,
            wall: index < routes - 1 ? north.id : island.id,
            wall_position: (index + 1) / (routes + 1),
            anchor_point: index + 1,
            type: 'Boulder',
            color: colors[index % colors.length],
            creator: ['E2E'],
            screw_date: '2026-09-01',
        })
        routeIds.push(route.id)
    }
    return {
        root,
        locationId: location.id,
        northWallId: north.id,
        islandWallId: island.id,
        routeIds,
        cleanup: async () => {
            const ticks = await root.collection('ticks').getFullList({
                filter: routeIds.map((id) => `route = "${id}"`).join(' || '),
                requestKey: null,
            })
            for (const tick of ticks)
                await root
                    .collection('ticks')
                    .delete(tick.id)
                    .catch(() => {})
            for (const id of routeIds)
                await root
                    .collection('routes')
                    .delete(id)
                    .catch(() => {})
            for (const id of [north.id, island.id])
                await root
                    .collection('walls')
                    .delete(id)
                    .catch(() => {})
            await root
                .collection('locations')
                .delete(location.id)
                .catch(() => {})
        },
    }
}

export async function settledBox(locator: Locator) {
    let previous = ''
    await expect
        .poll(async () => {
            const current = JSON.stringify(await locator.boundingBox())
            const settled = current === previous
            previous = current
            return settled
        })
        .toBe(true)
    return (await locator.boundingBox())!
}

export async function touchInput(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    type TouchPoint = { x: number; y: number; id?: number }
    return (type: string, point?: TouchPoint | TouchPoint[]) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: point ? [point].flat() : [],
        })
}

export const centerOf = (box: {
    x: number
    y: number
    width: number
    height: number
}) => ({
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
})
