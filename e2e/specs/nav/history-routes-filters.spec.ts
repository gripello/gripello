import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath, searchRoutes } from '../../support/nav'

async function pickLocation(page: Page, name: string, phone: boolean) {
    if (phone) await page.getByTestId('filter-open-sheet').click()
    await page.getByTestId('index-filter-location').click()
    await page.getByRole('option', { name, exact: true }).click()
    if (phone) {
        await page
            .getByTestId('filter-sheet')
            .getByTestId('dialog-close')
            .click()
        await expect(page.getByTestId('filter-sheet')).toBeHidden()
    }
}

for (const [device, viewport] of [
    ['phone', { width: 360, height: 740 }],
    ['desktop', { width: 1440, height: 900 }],
] as const) {
    test.describe(`route list on ${device}`, () => {
        test.use({ viewport })

        test('search and filters survive opening a route and going back', async ({
            page,
            createRoute,
            workerLocation,
            testPrefix,
        }) => {
            const phone = device === 'phone'
            const first = await createRoute()
            const second = await createRoute()
            const row = (id: string) =>
                page.getByTestId(phone ? `route-card-${id}` : `index-row-${id}`)

            await gotoSettled(page, gymPath('/routes'))
            await searchRoutes(page, testPrefix)
            await pickLocation(page, workerLocation.name, phone)
            await expect(row(first.id)).toBeVisible()
            await expect(row(second.id)).toBeVisible()

            const opener = phone
                ? row(first.id)
                : page.locator('tr', { has: row(first.id) })
            await opener.getByTestId('route-view').click()
            await page.waitForURL(/\/route\?id=/)

            await page.goBack()
            await expect(page).toHaveURL(gymPath('/routes'))
            await expect(page.getByTestId('filter-search')).toHaveValue(
                testPrefix,
            )
            await expect(row(first.id)).toBeVisible()
            await expect(row(second.id)).toBeVisible()
            if (phone) await page.getByTestId('filter-open-sheet').click()
            await expect(
                page.getByTestId('index-filter-location'),
            ).toContainText(workerLocation.name)
        })
    })
}
