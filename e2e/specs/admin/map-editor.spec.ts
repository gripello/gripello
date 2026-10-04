import type { Page } from '@playwright/test'
import PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { authAsSuperuser, e2eGymId } from '../../support/seed'
import { gotoSettled } from '../../support/nav'
import { PB_URL, seedMap } from '../../support/map'

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
}) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const location = await root.collection('locations').create({
        name: `${testPrefix} Editor Hall`,
        gym: await e2eGymId(root),
    })
    const wallName = `${testPrefix} Cave`
    try {
        await gotoSettled(page, `/admin/map?location=${location.id}`)
        await page.getByTestId('map-editor-setup-width').fill('20')
        await page.getByTestId('map-editor-setup-height').fill('10')
        await page.getByTestId('map-editor-create').click()
        await expect(page.getByTestId('map-editor-canvas')).toBeVisible()

        await page.getByTestId('map-editor-new-wall').fill(wallName)
        await page.getByTestId('map-editor-add-wall').click()
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
        const walls = await root.collection('walls').getFullList({
            filter: `location = "${location.id}"`,
        })
        expect(walls).toHaveLength(1)
        expect(walls[0]!.outline).toHaveLength(4)
        expect(walls[0]!.edge).toHaveLength(2)
    } finally {
        const walls = await root.collection('walls').getFullList({
            filter: `location = "${location.id}"`,
        })
        for (const wall of walls) await root.collection('walls').delete(wall.id)
        await root.collection('locations').delete(location.id)
    }
})

test('creating a floor plan with the default size opens the editor', async ({
    adminPage: page,
    testPrefix,
}) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const location = await root.collection('locations').create({
        name: `${testPrefix} Default Hall`,
        gym: await e2eGymId(root),
    })
    try {
        await gotoSettled(page, `/admin/map?location=${location.id}`)
        await page.getByTestId('map-editor-create').click()
        await expect(page.getByTestId('map-editor-canvas')).toBeVisible()
        await expect(page.getByTestId('map-editor-shape-item')).toHaveCount(1)
        await expect(page.getByTestId('map-editor-save')).toBeEnabled()
    } finally {
        await root.collection('locations').delete(location.id)
    }
})

test('a wall without a climbing edge blocks saving and says what is missing', async ({
    adminPage: page,
    testPrefix,
}) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const seeded = await seedMap(root, testPrefix, { routes: 1 })
    const wallName = `${testPrefix} Slab`
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await page.getByTestId('map-editor-new-wall').fill(wallName)
        await page.getByTestId('map-editor-add-wall').click()
        await clickCanvas(page, [
            [0.2, 0.6],
            [0.4, 0.6],
            [0.4, 0.8],
            [0.2, 0.6],
        ])
        await expect(page.getByTestId('map-editor-hint')).toContainText(
            `climbing edge of "${wallName}"`,
        )
        await page.keyboard.press('Escape')

        await expect(page.getByTestId('map-editor-save')).toBeDisabled()
        await expect(page.getByTestId('map-editor-hint')).toContainText(
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
}) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const seeded = await seedMap(root, testPrefix, { routes: 1 })
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

test('a wall that still has routes cannot be deleted in the editor', async ({
    adminPage: page,
    testPrefix,
}) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const seeded = await seedMap(root, testPrefix, { routes: 1 })
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
}) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const seeded = await seedMap(root, testPrefix, { routes: 1 })
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

test('a wall stores the anchor range used for auto-placement', async ({
    adminPage: page,
    testPrefix,
}) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const seeded = await seedMap(root, testPrefix, { routes: 1 })
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
                const wall = await root
                    .collection('walls')
                    .getOne(seeded.islandWallId)
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
}) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const seeded = await seedMap(root, testPrefix, { routes: 2 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await page.getByTestId('map-editor-preview').click()
        await expect(page.getByTestId('map-view')).toBeVisible()
        await expect(page.getByTestId('map-route-dot')).toHaveCount(2)
    } finally {
        await seeded.cleanup()
    }
})

test('setters cannot open the map editor', async ({ setterPage: page }) => {
    await gotoSettled(page, '/admin/map')
    await expect(page).not.toHaveURL(/\/admin\/map/)
})
