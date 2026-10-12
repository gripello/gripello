import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test.beforeEach(async ({ adminPage: page }) => {
    await page.addInitScript(() =>
        localStorage.setItem('inventory-instructions-seen', '1'),
    )
})

test('shows controls beside both checklists, without tabs', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await gotoSettled(page, '/manage/inventory')

    await expect(page.getByTestId('inventory-tab-missing')).toHaveCount(0)
    await expect(page.getByTestId('inventory-missing-count')).toBeVisible()
    await expect(page.getByTestId('inventory-found-count')).toBeVisible()

    await expect(async () => {
        const missing = (await page
            .getByTestId('inventory-column-missing')
            .boundingBox())!
        const controls = (await page
            .getByTestId('inventory-controls')
            .boundingBox())!
        const found = (await page
            .getByTestId('inventory-column-found')
            .boundingBox())!

        expect(controls.x).toBeGreaterThanOrEqual(missing.x + missing.width)
        expect(found.x).toBeGreaterThanOrEqual(controls.x + controls.width)
    }).toPass()
})

for (const viewport of [
    { name: 'ipad portrait', width: 820, height: 1180 },
    { name: 'ipad landscape', width: 1180, height: 820 },
]) {
    test(`${viewport.name} puts controls on top and both checklists side by side`, async ({
        adminPage: page,
    }) => {
        await page.setViewportSize(viewport)
        await gotoSettled(page, '/manage/inventory')

        await expect(page.getByTestId('inventory-tab-missing')).toHaveCount(0)
        await expect(async () => {
            const controls = (await page
                .getByTestId('inventory-controls')
                .boundingBox())!
            const missing = (await page
                .getByTestId('inventory-column-missing')
                .boundingBox())!
            const found = (await page
                .getByTestId('inventory-column-found')
                .boundingBox())!

            expect(missing.y).toBeGreaterThanOrEqual(
                controls.y + controls.height,
            )
            expect(found.y).toBe(missing.y)
            expect(found.x).toBeGreaterThanOrEqual(missing.x + missing.width)
            expect(missing.width + found.width).toBeGreaterThan(
                viewport.width * 0.8,
            )
        }).toPass()
    })
}

test('runs an inventory without a camera: pick a site, mark a route found', async ({
    adminPage: page,
    route,
    workerLocation,
}) => {
    await gotoSettled(page, '/manage/inventory')

    await page.getByTestId(`inventory-location-${workerLocation.name}`).click()

    await expect(
        page.getByTestId(`inventory-missing-${route.id}`),
    ).toBeVisible()
    await page.getByTestId(`inventory-mark-${route.id}`).click()

    await expect(
        page.getByTestId(`inventory-scanned-${route.id}`),
    ).toBeVisible()
    await expect(page.getByTestId(`inventory-missing-${route.id}`)).toHaveCount(
        0,
    )
    await expect(page.getByTestId('inventory-progress')).toContainText('1/1')
    await expect(page.getByTestId('inventory-change-location')).toContainText(
        workerLocation.name,
    )

    await expect(page.getByTestId('inventory-change-location')).toHaveAttribute(
        'aria-label',
        'Change location',
    )

    await page.getByTestId(`inventory-undo-${route.id}`).click()
    await expect(
        page.getByTestId(`inventory-missing-${route.id}`),
    ).toBeVisible()
})

test('manual add dialog opens from the missing column', async ({
    adminPage: page,
    route,
    workerLocation,
}) => {
    await gotoSettled(page, '/manage/inventory')
    await page.getByTestId(`inventory-location-${workerLocation.name}`).click()
    await expect(
        page.getByTestId(`inventory-missing-${route.id}`),
    ).toBeVisible()

    await page.getByTestId('inventory-manual-open').click()
    await expect(page.getByTestId('inventory-manual-dialog')).toBeVisible()
})
