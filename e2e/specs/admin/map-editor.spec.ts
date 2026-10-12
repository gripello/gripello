import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import {
    createLocation,
    deleteLocation,
    deleteWall,
    listLocations,
    listWalls,
    updateWall,
} from '../../support/api'
import { gotoSettled } from '../../support/nav'
import { seedMap } from '../../support/map'

async function clickCanvas(page: Page, points: [number, number][]) {
    const canvas = page.getByTestId('map-editor-canvas')
    const box = (await canvas.boundingBox())!
    for (const [x, y] of points) {
        await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
    }
}

test('admins draw a floor plan with a wall and it survives a reload', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const location = await createLocation(adminApi, `${testPrefix} Editor Hall`)
    const wallName = `${testPrefix} Cave`
    try {
        await gotoSettled(page, `/admin/map?location=${location.id}`)
        await page.getByTestId('map-editor-setup-width').fill('20')
        await page.getByTestId('map-editor-setup-height').fill('10')
        await page.getByTestId('map-editor-create').click()
        await expect(page.getByTestId('map-editor-canvas')).toBeVisible()

        await page.getByTestId('map-editor-add-wall').click()
        await page.getByTestId('map-editor-wall-name').fill(wallName)
        await page.getByTestId('map-editor-wall-name').press('Tab')
        await clickCanvas(page, [
            [0.3, 0.3],
            [0.6, 0.3],
            [0.6, 0.5],
            [0.3, 0.5],
            [0.3, 0.3],
        ])
        await clickCanvas(page, [
            [0.3, 0.5],
            [0.6, 0.5],
        ])
        await page.keyboard.press('Enter')

        const wallItem = page.locator(
            `[data-testid="map-editor-wall-item"][data-name="${wallName}"]`,
        )
        await expect(wallItem).toBeVisible()
        await expect(wallItem).not.toContainText('missing')

        await page.getByTestId('map-editor-save').click()
        await expect(page.getByTestId('global-snackbar').last()).toContainText(
            'Map saved',
        )

        await gotoSettled(page, `/admin/map?location=${location.id}`)
        await expect(
            page.locator(
                `[data-testid="map-editor-wall"][data-name="${wallName}"]`,
            ),
        ).toHaveCount(1)
        const walls = await listWalls(adminApi, location.id)
        expect(walls).toHaveLength(1)
        expect(walls[0]!.outline).toHaveLength(4)
        expect(walls[0]!.edge).toHaveLength(2)
    } finally {
        for (const wall of await listWalls(adminApi, location.id))
            await deleteWall(adminApi, wall.id)
        await deleteLocation(adminApi, location.id)
    }
})

test('creating a floor plan with the default size opens the editor', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const location = await createLocation(
        adminApi,
        `${testPrefix} Default Hall`,
    )
    try {
        await gotoSettled(page, `/admin/map?location=${location.id}`)
        await page.getByTestId('map-editor-create').click()
        await expect(page.getByTestId('map-editor-canvas')).toBeVisible()
        await expect(page.getByTestId('map-editor-shape-item')).toHaveCount(1)
        await expect(page.getByTestId('map-editor-save')).toBeEnabled()
    } finally {
        await deleteLocation(adminApi, location.id)
    }
})

test('a wall without a climbing edge blocks saving and says what is missing', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    const wallName = `${testPrefix} Slab`
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await page.getByTestId('map-editor-add-wall').click()
        await page.getByTestId('map-editor-wall-name').fill(wallName)
        await page.getByTestId('map-editor-wall-name').press('Tab')
        await clickCanvas(page, [
            [0.2, 0.6],
            [0.4, 0.6],
            [0.4, 0.8],
            [0.2, 0.6],
        ])
        await expect(page.getByTestId('map-editor-step-edge')).toHaveAttribute(
            'data-state',
            'active',
        )
        await page.keyboard.press('Escape')

        await expect(page.getByTestId('map-editor-save')).toBeDisabled()
        await expect(page.getByTestId('map-editor-bar')).toContainText(
            'Climbing edge missing',
        )

        await page.getByTestId('map-editor-draw-edge').click()
        await clickCanvas(page, [
            [0.2, 0.6],
            [0.4, 0.6],
        ])
        await page.keyboard.press('Enter')
        await expect(page.getByTestId('map-editor-save')).toBeEnabled()
    } finally {
        await seeded.cleanup()
    }
})

test('drawing a mat can be undone and redone', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        const shapes = page.getByTestId('map-editor-shape-item')
        await expect(shapes).toHaveCount(1)

        await page.getByTestId('map-editor-tool-mat').click()
        await clickCanvas(page, [
            [0.2, 0.6],
            [0.4, 0.6],
            [0.4, 0.8],
        ])
        await page.keyboard.press('Enter')
        await expect(shapes).toHaveCount(2)

        await page.getByTestId('map-editor-undo').click()
        await expect(shapes).toHaveCount(1)
        await page.keyboard.press('Control+Shift+Z')
        await expect(shapes).toHaveCount(2)
        await expect(page.getByTestId('map-editor-save')).toBeEnabled()
    } finally {
        await seeded.cleanup()
    }
})

test('walkways, entrances and lines can be drawn', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        const shapes = page.getByTestId('map-editor-shape-item')
        await expect(shapes).toHaveCount(1)

        await page.getByTestId('map-editor-tool-path').click()
        await clickCanvas(page, [
            [0.2, 0.6],
            [0.5, 0.6],
            [0.5, 0.7],
        ])
        await page.keyboard.press('Enter')
        await page.getByTestId('map-editor-tool-line').click()
        await clickCanvas(page, [
            [0.6, 0.8],
            [0.8, 0.8],
        ])
        await page.keyboard.press('Enter')

        await expect(shapes).toHaveCount(3)
        await expect(shapes.nth(1)).toContainText('Walkway')
        await expect(shapes.nth(2)).toContainText('Line')
        await expect(
            page.locator('[data-testid="map-floor-shape"][data-kind="line"]'),
        ).toHaveCount(1)
        await page.getByTestId('map-editor-save').click()
        await expect(page.getByTestId('global-snackbar').last()).toContainText(
            'Map saved',
        )
    } finally {
        await seeded.cleanup()
    }
})

test('a wall that still has routes cannot be deleted in the editor', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    const wallItem = (name: string) =>
        page.locator(
            `[data-testid="map-editor-wall-item"][data-name="${testPrefix} ${name}"]`,
        )
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await wallItem('Island').click()
        await expect(page.getByTestId('map-editor-delete-wall')).toBeDisabled()
        await expect(
            page.getByTestId('map-editor-wall-has-routes'),
        ).toBeVisible()

        await wallItem('North').click()
        await expect(page.getByTestId('map-editor-delete-wall')).toBeEnabled()
        await expect(
            page.getByTestId('map-editor-wall-has-routes'),
        ).toHaveCount(0)
    } finally {
        await seeded.cleanup()
    }
})

test('the name of a selected wall can be dragged', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await page
            .locator(
                `[data-testid="map-editor-wall-item"][data-name="${testPrefix} Island"]`,
            )
            .click()
        const label = page
            .locator(
                `[data-testid="map-editor-wall"][data-name="${testPrefix} Island"]`,
            )
            .getByTestId('map-editor-wall-label')
        const before = (await label.boundingBox())!
        await page.mouse.move(
            before.x + before.width / 2,
            before.y + before.height / 2,
        )
        await page.mouse.down()
        await page.mouse.move(
            before.x + before.width / 2 + 60,
            before.y + before.height / 2 + 30,
            { steps: 8 },
        )
        await page.mouse.up()
        const after = (await label.boundingBox())!
        expect(after.x).toBeGreaterThan(before.x + 30)
        await expect(page.getByTestId('map-editor-save')).toBeEnabled()
    } finally {
        await seeded.cleanup()
    }
})

test('a selected wall moves with its move handle and the map still pans over it', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await page
            .locator(
                `[data-testid="map-editor-wall-item"][data-name="${testPrefix} North"]`,
            )
            .click()
        const wall = page.locator(
            `[data-testid="map-editor-wall"][data-name="${testPrefix} North"]`,
        )
        const before = (await wall.boundingBox())!
        const handle = (await page
            .getByTestId('map-editor-move')
            .boundingBox())!
        await page.mouse.move(
            handle.x + handle.width / 2,
            handle.y + handle.height / 2,
        )
        await page.mouse.down()
        await page.mouse.move(
            handle.x + handle.width / 2,
            handle.y + handle.height / 2 + 60,
            { steps: 8 },
        )
        await page.mouse.up()
        const after = (await wall.boundingBox())!
        expect(after.y).toBeGreaterThan(before.y + 30)

        await page.mouse.move(after.x + 20, after.y + after.height / 2)
        await page.mouse.down()
        await page.mouse.move(after.x + 120, after.y + after.height / 2, {
            steps: 8,
        })
        await page.mouse.up()
        const panned = (await wall.boundingBox())!
        expect(panned.x).toBeGreaterThan(after.x + 60)
        expect(panned.y).toBeCloseTo(after.y, 0)

        await page.getByTestId('map-editor-undo').click()
        expect((await wall.boundingBox())!.y).toBeCloseTo(
            before.y + panned.y - after.y,
            0,
        )
    } finally {
        await seeded.cleanup()
    }
})

test('a wall stores the anchor range used for auto-placement', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await page
            .locator(
                `[data-testid="map-editor-wall-item"][data-name="${testPrefix} Island"]`,
            )
            .click()
        const from = page.getByTestId('map-editor-wall-anchor-from')
        await from.fill('10')
        await from.press('Tab')
        const to = page.getByTestId('map-editor-wall-anchor-to')
        await to.fill('20')
        await to.press('Tab')
        await page.getByTestId('map-editor-save').click()
        await expect
            .poll(async () => {
                const wall = (
                    await listWalls(adminApi, seeded.locationId)
                ).find((wall) => wall.id === seeded.islandWallId)!
                return [wall.anchor_from, wall.anchor_to]
            })
            .toEqual([10, 20])
    } finally {
        await seeded.cleanup()
    }
})

test('the preview shows the climber view of unsaved changes', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 2 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await page.getByTestId('map-editor-preview').click()
        await expect(page.getByTestId('map-view')).toBeVisible()
        await expect(page.getByTestId('map-route-dot')).toHaveCount(2)
        const list = page.getByTestId('map-editor-preview-list')
        await expect(list.getByTestId('map-list-route')).toHaveCount(2)

        await page
            .locator(
                `[data-testid="map-wall"][data-name="${testPrefix} Island"]`,
            )
            .focus()
        await page.keyboard.press('Enter')
        await expect(list.getByTestId('map-list-route')).toHaveCount(1)
        await expect(page.getByTestId('map-editor-sheet')).toContainText(
            `${testPrefix} Island`,
        )
    } finally {
        await seeded.cleanup()
    }
})

test('an edit made elsewhere is offered instead of being overwritten', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await page.getByTestId('map-editor-tool-mat').click()
        const box = (await page.getByTestId('map-editor-canvas').boundingBox())!
        for (const [x, y] of [
            [0.2, 0.6],
            [0.4, 0.6],
            [0.4, 0.8],
        ])
            await page.mouse.click(
                box.x + box.width * x!,
                box.y + box.height * y!,
            )
        await page.keyboard.press('Enter')
        await expect(page.getByTestId('map-editor-save')).toBeEnabled()

        await updateWall(adminApi, seeded.northWallId, {
            name: `${testPrefix} Renamed`,
        })
        const notice = page.getByTestId('map-editor-changed-elsewhere')
        await expect(notice).toBeVisible()
        await notice.getByRole('button', { name: 'Load theirs' }).click()
        await expect(notice).toBeHidden()
        await expect(
            page.locator(
                `[data-testid="map-editor-wall-item"][data-name="${testPrefix} Renamed"]`,
            ),
        ).toHaveCount(1)
        await expect(page.getByTestId('map-editor-save')).toBeDisabled()
    } finally {
        await seeded.cleanup()
    }
})

const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8Dwn4EBAAj+Af9IxWaQAAAAAElFTkSuQmCC',
    'base64',
)

test('a tracing image waits for Save and can be undone before that', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    const traceOf = async () =>
        (await listLocations(adminApi)).find(
            (location) => location.id === seeded.locationId,
        )?.map_trace
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        const upload = page.getByTestId('map-editor-trace-upload')
        await upload.setInputFiles({
            name: 'plan.png',
            mimeType: 'image/png',
            buffer: PIXEL_PNG,
        })
        await expect(page.getByTestId('map-editor-trace')).toHaveCount(1)
        expect(await traceOf()).toBeFalsy()

        await page.getByTestId('map-editor-undo').click()
        await expect(page.getByTestId('map-editor-trace')).toHaveCount(0)

        await page.getByTestId('map-editor-redo').click()
        await page.getByTestId('map-editor-save').click()
        await expect(page.getByTestId('global-snackbar').last()).toContainText(
            'Map saved',
        )
        await expect.poll(traceOf).toBeTruthy()
    } finally {
        await seeded.cleanup()
    }
})

test('setters cannot open the map editor', async ({ setterPage: page }) => {
    await gotoSettled(page, '/admin/map')
    await expect(page).not.toHaveURL(/\/admin\/map/)
})
