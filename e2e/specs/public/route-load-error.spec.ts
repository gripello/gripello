import { test, expect } from '../../support/fixtures'
import { gotoSettled, searchRoutes } from '../../support/nav'

test('a failing route request shows a server error instead of 404', async ({
    page,
    route,
}) => {
    await gotoSettled(page, '/routes')
    await searchRoutes(page, route.name)
    await page.route(`**/api/routes/${route.id}*`, (r) =>
        r.fulfill({ status: 500, json: { status: 500, message: 'boom' } }),
    )
    await page.getByTestId('route-view').first().click()
    await expect(page.getByTestId('error-status')).toContainText('500')
})

test('an unreachable backend shows a server error instead of 404', async ({
    page,
    route,
}) => {
    await gotoSettled(page, '/routes')
    await searchRoutes(page, route.name)
    await page.route(`**/api/routes/${route.id}*`, (r) => r.abort('failed'))
    await page.getByTestId('route-view').first().click()
    await expect(page.getByTestId('error-status')).toContainText('503')
})
