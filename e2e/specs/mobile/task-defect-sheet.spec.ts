import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('defect report opens as a bottom sheet on mobile', async ({
    page,
    route,
}) => {
    await gotoSettled(page, `/route?id=${route.id}`)
    await page.getByTestId('route-more-actions').click()
    await page.getByTestId('task-defect-open').click()

    const dialog = page.getByTestId('task-defect-dialog')
    await expect(dialog).toBeVisible()

    const viewport = page.viewportSize()!
    await expect
        .poll(async () => {
            const box = (await dialog.boundingBox())!
            return Math.abs(viewport.height - (box.y + box.height))
        })
        .toBeLessThanOrEqual(1)

    await page.getByTestId('task-defect-category-broken_hold').click()
    await page.getByTestId('task-defect-submit').click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('task-defect-banner')).toBeVisible()
})
