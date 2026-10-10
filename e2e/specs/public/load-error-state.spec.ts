import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

const overviewRoutes = (url: URL) =>
    /\/api\/gyms\/[^/]+\/routes$/.test(url.pathname) &&
    !url.searchParams.has('total')

test('the overview offers a retry when its routes fail to load', async ({
    page,
}) => {
    await gotoSettled(page, '/routes')
    await page.route(overviewRoutes, (route) => route.abort('failed'))
    await page.getByTestId('nav-link-home').click()
    await page.waitForURL((url) => url.pathname === gymPath('/'))

    const loadError = page.getByTestId('load-error')
    await expect(loadError).toBeVisible()
    await expect(loadError).toHaveAttribute('role', 'alert')

    const retry = page.getByTestId('load-error-retry')
    const refetch = page.waitForRequest((request) =>
        overviewRoutes(new URL(request.url())),
    )
    await retry.click()
    await refetch
    await expect(loadError).toBeVisible()

    await page.unroute(overviewRoutes)
    await expect(async () => {
        if (await retry.isVisible()) await retry.click({ timeout: 2_000 })
        await expect(loadError).toBeHidden({ timeout: 2_000 })
    }).toPass()
})
