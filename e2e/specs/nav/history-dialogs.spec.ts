import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { createRating } from '../../support/api'

for (const [device, viewport] of [
    ['phone', { width: 360, height: 740 }],
    ['desktop', { width: 1440, height: 900 }],
] as const) {
    test.describe(`dialog history on ${device}`, () => {
        test.use({ viewport })

        test('back closes an open dialog first, then leaves the page', async ({
            page,
            route,
        }) => {
            const routeUrl = `${gymPath('/route')}?id=${route.id}`
            await gotoSettled(page, gymPath('/routes'))
            await gotoSettled(page, routeUrl)
            const dialog = page.getByTestId('review-form-dialog')

            await page.getByTestId('review-open-cta').click()
            await expect(dialog).toBeVisible()
            await page.goBack()
            await expect(dialog).toBeHidden()
            await expect(page).toHaveURL(routeUrl)

            await page.goBack()
            await expect(page).toHaveURL(gymPath('/routes'))
        })

        test('a cancelled dialog leaves no extra history step', async ({
            page,
            route,
        }) => {
            await gotoSettled(page, gymPath('/routes'))
            await gotoSettled(page, `${gymPath('/route')}?id=${route.id}`)

            await page.getByTestId('review-open-cta').click()
            await page.getByTestId('review-form-cancel').click()
            await expect(page.getByTestId('review-form-dialog')).toBeHidden()

            await page.goBack()
            await expect(page).toHaveURL(gymPath('/routes'))
        })

        test('a link inside a dialog navigates and back does not reopen it', async ({
            page,
            route,
            adminApi,
            testPrefix,
        }) => {
            await createRating(adminApi, route.id, {
                comment: `${testPrefix}-dialog-link`,
            })
            const routeUrl = `${gymPath('/route')}?id=${route.id}`
            await gotoSettled(page, gymPath('/routes'))
            await gotoSettled(page, routeUrl)

            await page.getByTestId('comment-card-report').first().click()
            const dialog = page.getByTestId('report-form-dialog')
            await expect(dialog).toBeVisible()
            await dialog.getByRole('link', { name: 'Privacy' }).first().click()
            await page.waitForURL(gymPath('/privacy'))
            await expect(dialog).toBeHidden()

            await page.goBack()
            await expect(page).toHaveURL(routeUrl)
            await expect(page.getByTestId('page-hydrated')).toBeAttached()
            await expect(dialog).toBeHidden()

            await page.goBack()
            await expect(page).toHaveURL(gymPath('/routes'))
        })
    })
}
