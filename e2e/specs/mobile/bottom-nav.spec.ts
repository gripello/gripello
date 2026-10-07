import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('the bottom bar leads to gym, community, scanner and account', async ({
    page,
}) => {
    await gotoSettled(page, '/map')
    await expect(page.getByTestId('bottom-nav')).toBeVisible()
    await expect(page.getByTestId('bottom-nav-home')).toHaveCount(0)

    await page.getByTestId('bottom-nav-scan').click()
    await page.waitForURL('**/scan')
    await expect(page.getByTestId('scan-page')).toBeVisible()

    await page.getByTestId('bottom-nav-account').click()
    await page.waitForURL('**/account')
    await expect(page.getByTestId('me-guest')).toBeVisible()

    await page.getByTestId('bottom-nav-feed').click()
    await page.waitForURL('**/feed')
    await page.getByTestId('bottom-nav-routes').click()
    await page.waitForURL('**/routes')
})

test('signed-in climbers reach their logbook and account', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/map')
    await page.getByTestId('bottom-nav-logbook').click()
    await page.waitForURL('**/logbook')
    await page.getByTestId('bottom-nav-account').click()
    await page.waitForURL('**/account')
    await expect(page.getByTestId('me-name')).toBeVisible()
})

test('the route manager pager stays above the bottom bar', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    const pager = page.getByTestId('routes-mobile-pagination')
    await expect(pager).toBeVisible()
    await expect(async () => {
        const bar = (await page.getByTestId('bottom-nav').boundingBox())!
        const pagerBox = (await pager.boundingBox())!
        expect(pagerBox.y + pagerBox.height).toBeLessThanOrEqual(bar.y + 1)
    }).toPass()
})

test('the footer links stay above the bottom bar', async ({ page }) => {
    await gotoSettled(page, '/account')
    await expect(async () => {
        await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
        )
        const bar = (await page.getByTestId('bottom-nav').boundingBox())!
        const links = (await page
            .getByTestId('me-info')
            .getByTestId('footer-privacy')
            .boundingBox())!
        expect(links.y + links.height).toBeLessThanOrEqual(bar.y)
    }).toPass()
})

test('on phones the footer lives on the account tab only', async ({ page }) => {
    await gotoSettled(page, '/scan')
    await expect(page.getByTestId('app-footer')).toBeHidden()
    await gotoSettled(page, '/account')
    await expect(
        page.getByTestId('me-info').getByTestId('footer-privacy'),
    ).toBeVisible()
})
