import { test, expect } from '../../support/fixtures'
import { e2eGymId, uiaa } from '../../support/seed'
import { authHeader, gotoSettled } from '../../support/nav'
import { seedMap } from '../../support/map'

const outline = [
    [1, 1],
    [4, 1],
    [4, 3],
]
const edge = [
    [1, 1],
    [4, 1],
]

test('only settings managers may draw walls', async ({
    setterPage: page,
    root,
    testPrefix,
}) => {
    const seeded = await seedMap(root, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, '/manage/routes')
        const headers = await authHeader(page)
        const created = await page.request.post(
            '/api/collections/walls/records',
            {
                headers,
                data: {
                    location: seeded.locationId,
                    name: `${testPrefix} Setter Wall`,
                    outline,
                    edge,
                },
            },
        )
        expect(created.status()).toBe(400)

        const updated = await page.request.patch(
            `/api/collections/walls/records/${seeded.northWallId}`,
            { headers, data: { name: 'Renamed by setter' } },
        )
        expect(updated.status()).toBe(404)
    } finally {
        await seeded.cleanup()
    }
})

test('walls must fit the floor plan and routes must stay in their location', async ({
    root,
    testPrefix,
}) => {
    const seeded = await seedMap(root, testPrefix, { routes: 1 })
    const otherLocation = await root
        .collection('locations')
        .create({ name: `${testPrefix} Plain Hall`, gym: await e2eGymId(root) })
    try {
        await expect(
            root.collection('walls').create({
                location: otherLocation.id,
                name: `${testPrefix} No Plan`,
                outline,
                edge,
            }),
        ).rejects.toMatchObject({ status: 400 })

        await expect(
            root.collection('walls').create({
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
            root.collection('routes').create({
                name: `${testPrefix}-wrong-wall`,
                ...uiaa('5'),
                location: otherLocation.id,
                wall: seeded.northWallId,
                type: 'Boulder',
                creator: ['E2E'],
            }),
        ).rejects.toMatchObject({ status: 400 })

        const moved = await root
            .collection('routes')
            .update(seeded.routeIds[0]!, { location: otherLocation.id })
        expect(moved.wall).toBe('')
    } finally {
        await seeded.cleanup()
        await root.collection('locations').delete(otherLocation.id)
    }
})

test('a wall with active routes cannot be deleted', async ({
    adminPage: page,
    root,
    testPrefix,
}) => {
    const seeded = await seedMap(root, testPrefix, { routes: 2 })
    try {
        await gotoSettled(page, '/admin/settings')
        const headers = await authHeader(page)
        const blocked = await page.request.delete(
            `/api/collections/walls/records/${seeded.northWallId}`,
            { headers },
        )
        expect(blocked.status()).toBe(400)

        await root
            .collection('routes')
            .update(seeded.routeIds[0]!, { archived: true })
        const allowed = await page.request.delete(
            `/api/collections/walls/records/${seeded.northWallId}`,
            { headers },
        )
        expect(allowed.status()).toBe(204)
    } finally {
        await seeded.cleanup()
    }
})
