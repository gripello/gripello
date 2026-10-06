import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('logs out and redirects to login', async ({ adminPage: page }) => {
    await gotoSettled(page, '/manage/routes', '**/manage/routes')
    if ((page.viewportSize()?.width ?? 0) >= 1280) {
        await page.getByTestId('user-menu-activator').click()
        await page.getByTestId('user-menu-logout').click()
    } else {
        const back = page.getByTestId('nav-back-to-climbing-mobile')
        await back.or(page.getByTestId('bottom-nav-account')).first().waitFor()
        if (await back.isVisible()) await back.click()
        await page.getByTestId('bottom-nav-account').click()
        await page.getByTestId('me-logout').click()
    }
    await page.waitForURL('**/auth/login')
    await expect(page.getByTestId('login-form')).toBeVisible()
})
