import type { Page } from '@playwright/test'
import { test as base, expect, authFile } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { getRoute } from '../../support/api'

const test = base.extend<{ newYorkAdminPage: Page }>({
    newYorkAdminPage: async ({ browser, deviceOptions }, use) => {
        const context = await browser.newContext({
            ...deviceOptions,
            storageState: authFile('admin'),
            timezoneId: 'America/New_York',
        })
        await use(await context.newPage())
        await context.close()
    },
})

test('editing a route west of UTC keeps its set date', async ({
    newYorkAdminPage: page,
    createRoute,
    adminApi,
}) => {
    const route = await createRoute({ screw_date: '2026-03-14' })

    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(route.name)
    await expect(page.getByTestId('routes-row-name')).toHaveText([route.name])
    await page.getByTestId('routes-row-edit').first().click()
    await expect(page.getByTestId('route-form-dialog')).toBeVisible()
    await expect(page.getByTestId('route-form-screw-date')).toHaveValue(
        '2026-03-14',
    )
    await page.getByTestId('route-form-submit').click()
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    await expect
        .poll(async () => (await getRoute(adminApi, route.id)).screw_date)
        .toMatch(/^2026-03-14/)
})
