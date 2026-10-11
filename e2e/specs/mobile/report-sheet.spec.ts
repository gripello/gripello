import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createRating } from '../../support/api'

test('report form opens as a bottom sheet on mobile', async ({
    page,
    adminApi,
    route,
    testPrefix,
}) => {
    await createRating(adminApi, route.id, {
        rating: 4,
        comment: `${testPrefix}-report-me`,
    })

    await gotoSettled(page, `/route?id=${route.id}`)
    await page.getByTestId('comment-card-report').first().click()

    const dialog = page.getByTestId('report-form-dialog')
    await expect(dialog).toBeVisible()

    const viewport = page.viewportSize()!
    await expect
        .poll(async () => {
            const box = (await dialog.boundingBox())!
            return Math.abs(viewport.height - (box.y + box.height))
        })
        .toBeLessThanOrEqual(1)

    await expect
        .poll(async () => (await dialog.boundingBox())!.width)
        .toBeGreaterThanOrEqual(viewport.width - 1)
})
