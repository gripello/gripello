import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { seedMap } from '../../support/map'

test.describe('narrow editor', () => {
    test.use({ viewport: { width: 700, height: 1000 } })

    test('keeps the canvas full width and opens the panel as a sheet', async ({
        adminPage: page,
        testPrefix,
        adminApi,
    }) => {
        const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
        try {
            await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
            const canvas = page.getByTestId('map-editor-canvas')
            const sheet = page.getByTestId('map-editor-sheet')
            await expect(canvas).toBeVisible()
            await expect(sheet.getByTestId('map-editor-panel')).toBeVisible()

            const canvasBox = (await canvas.boundingBox())!
            const sheetBox = (await sheet.boundingBox())!
            expect(canvasBox.width).toBeGreaterThan(650)
            expect(sheetBox.width).toBeGreaterThan(650)
            expect(sheetBox.y).toBeGreaterThan(canvasBox.y)
            await expect(
                sheet.locator(
                    `[data-testid="map-editor-wall-item"][data-name="${testPrefix} North"]`,
                ),
            ).toBeVisible()
        } finally {
            await seeded.cleanup()
        }
    })
})

test('leaving with unsaved changes asks in a dialog', async ({
    adminPage: page,
    testPrefix,
    adminApi,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        await page
            .getByTestId('map-editor-new-wall')
            .fill(`${testPrefix} Draft`)
        await page.getByTestId('map-editor-add-wall').click()
        await expect(
            page.locator(
                `[data-testid="map-editor-wall-item"][data-name="${testPrefix} Draft"]`,
            ),
        ).toBeVisible()

        const mapLink = page.getByTestId('nav-back-to-climbing')
        await mapLink.click()
        const dialog = page.getByTestId('confirm-dialog')
        await expect(dialog).toBeVisible()
        await page.getByTestId('confirm-dialog-cancel').click()
        await expect(dialog).toBeHidden()
        await expect(page).toHaveURL(/\/admin\/map/)

        await mapLink.click()
        await page.getByTestId('confirm-dialog-confirm').click()
        await page.waitForURL(/\/routes(\?|$)/)
    } finally {
        await seeded.cleanup()
    }
})
