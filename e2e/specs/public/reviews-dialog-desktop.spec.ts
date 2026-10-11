import type { Page } from '@playwright/test'
import type { RouteRecord } from '../../../types/models'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createRating } from '../../support/api'

test.beforeEach(async ({ adminApi, route, testPrefix }) => {
    await createRating(adminApi, route.id, {
        rating: 4,
        comment: `${testPrefix}-review`,
    })
})

async function openReviewsFor(page: Page, route: RouteRecord) {
    await gotoSettled(page, '/routes')

    await page.getByTestId('filter-search').first().fill(route.name)

    const row = page
        .getByRole('row')
        .filter({ has: page.getByTestId(`index-row-${route.id}`) })
    await row.getByTestId('route-details-open').click()

    const dialog = page.getByTestId('route-details-sheet')
    await expect(dialog).toBeVisible()
    return dialog
}

test('the reviews dialog is centered on desktop, not pinned to the floor', async ({
    page,
    route,
}) => {
    const dialog = await openReviewsFor(page, route)

    const viewport = page.viewportSize()!
    await expect
        .poll(async () => {
            const box = (await dialog.boundingBox())!
            return {
                floats: viewport.height - (box.y + box.height) > 24,
                narrower: box.width < viewport.width,
            }
        })
        .toEqual({ floats: true, narrower: true })
})

test('reviews in the dialog can be reported', async ({ page, route }) => {
    const dialog = await openReviewsFor(page, route)

    const reportButton = dialog.getByTestId('comment-card-report').first()
    await expect(reportButton).toBeVisible()
    await reportButton.click()

    await expect(page.getByTestId('report-form-dialog')).toBeVisible()
})

test('the reviews dialog close button has an accessible name', async ({
    page,
    route,
}) => {
    const dialog = await openReviewsFor(page, route)

    await expect(dialog.getByTestId('dialog-close')).toBeVisible()
    await expect(page.getByRole('button', { name: /close/i })).toBeVisible()
})
