import { test, expect } from '../../support/fixtures'
import { gotoSettled, searchRoutes } from '../../support/nav'

test('shows the public route list unauthenticated', async ({ page }) => {
    await gotoSettled(page, '/routes')
    await expect(page.getByTestId('index-table')).toBeVisible()
})

test('shows a sign-in button when logged out', async ({ page }) => {
    await gotoSettled(page, '/routes')
    await expect(
        page
            .getByTestId('nav-login')
            .or(page.getByTestId('sidebar-login'))
            .filter({ visible: true }),
    ).toBeVisible()
})

test('the view action opens the route page', async ({ page, route }) => {
    await gotoSettled(page, '/routes')
    await searchRoutes(page, route.name)
    await page.getByTestId('route-view').first().click()
    await page.waitForURL(new RegExp(`/route\\?id=${route.id}`))
    await expect(page.getByTestId('route-page-name')).toBeVisible()
})
