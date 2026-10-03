import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

test('the overview offers a retry when its routes fail to load', async ({
    page,
}) => {
    await gotoSettled(page, '/routes')
    await page.route('**/api/collections/averageRating/records*', (route) =>
        route.abort('failed'),
    )
    await page.getByTestId('nav-link-home').click()
    await page.waitForURL((url) => url.pathname === gymPath('/'))

    const loadError = page.getByTestId('load-error')
    await expect(loadError).toBeVisible()
    await expect(loadError).toHaveAttribute('role', 'alert')

    const retry = page.getByTestId('load-error-retry')
    const refetch = page.waitForRequest(
        '**/api/collections/averageRating/records*',
    )
    await retry.click()
    await refetch
    await expect(loadError).toBeVisible()

    await page.unroute('**/api/collections/averageRating/records*')
    await expect(async () => {
        if (await retry.isVisible()) await retry.click({ timeout: 2_000 })
        await expect(loadError).toBeHidden({ timeout: 2_000 })
    }).toPass()
})
