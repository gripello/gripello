import { test, expect } from '../../support/fixtures'
import { uiaa } from '../../support/seed'
import { apiOf, gotoSettled } from '../../support/nav'
import { seedMap } from '../../support/map'
import {
    ApiError,
    archiveRoute,
    createLocation,
    createRoute,
    createWall,
    deleteLocation,
    deleteWall,
    updateRoute,
    updateWall,
} from '../../support/api'

const outline = [
    [1, 1],
    [4, 1],
    [4, 3],
]
const edge = [
    [1, 1],
    [4, 1],
]

const statusOf = (request: Promise<unknown>) =>
    request.then(
        () => 200,
        (error: ApiError) => error.status,
    )

test('only settings managers may draw walls', async ({
    setterPage: page,
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, '/manage/routes')
        const setter = await apiOf(page)
        expect([400, 403]).toContain(
            await statusOf(
                createWall(setter, {
                    location: seeded.locationId,
                    name: `${testPrefix} Setter Wall`,
                    outline,
                    edge,
                }),
            ),
        )

        expect([403, 404]).toContain(
            await statusOf(
                updateWall(setter, seeded.northWallId, {
                    name: 'Renamed by setter',
                }),
            ),
        )
    } finally {
        await seeded.cleanup()
    }
})

test('walls must fit the floor plan and routes must stay in their location', async ({
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    const otherLocation = await createLocation(
        adminApi,
        `${testPrefix} Plain Hall`,
    )
    try {
        await expect(
            createWall(adminApi, {
                location: otherLocation.id,
                name: `${testPrefix} No Plan`,
                outline,
                edge,
            }),
        ).rejects.toMatchObject({ status: 400 })

        await expect(
            createWall(adminApi, {
                location: seeded.locationId,
                name: `${testPrefix} Outside`,
                outline: [
                    [1, 1],
                    [99, 1],
                    [4, 3],
                ],
                edge,
            }),
        ).rejects.toMatchObject({ status: 400 })

        await expect(
            createRoute(adminApi, {
                name: `${testPrefix}-wrong-wall`,
                ...uiaa('5'),
                location: otherLocation.id,
                wall: seeded.northWallId,
                type: 'Boulder',
                creator: ['E2E'],
            }),
        ).rejects.toMatchObject({ status: 400 })

        const moved = await updateRoute(adminApi, seeded.routeIds[0]!, {
            location: otherLocation.id,
        })
        expect(moved.wall ?? '').toBe('')
    } finally {
        await seeded.cleanup()
        await deleteLocation(adminApi, otherLocation.id)
    }
})

test('a wall with active routes cannot be deleted', async ({
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 2 })
    try {
        await expect(
            deleteWall(adminApi, seeded.northWallId),
        ).rejects.toMatchObject({ status: 400 })

        await archiveRoute(adminApi, seeded.routeIds[0]!)
        await deleteWall(adminApi, seeded.northWallId)
    } finally {
        await seeded.cleanup()
    }
})
