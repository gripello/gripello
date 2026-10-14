import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('logs out without landing on the login page or reopening staff pages', async ({
    createUser,
    pageAs,
}) => {
    const page = await pageAs(await createUser('admin', 'logout'))
    await gotoSettled(page, '/manage/routes', '**/manage/routes')
    if ((page.viewportSize()?.width ?? 0) >= 1280) {
        await page.getByTestId('user-menu-activator').click()
        await page.getByTestId('user-menu-logout').click()
        await page.waitForURL((url) => url.pathname === '/')
        await page.goBack()
    } else {
        const back = page.getByTestId('nav-back-to-climbing-mobile')
        await back.or(page.getByTestId('bottom-nav-account')).first().waitFor()
        if (await back.isVisible()) await back.click()
        await page.getByTestId('bottom-nav-account').click()
        await page.getByTestId('me-logout').click()
        await expect(page.getByTestId('me-logout')).toHaveCount(0)
        await expect(page).toHaveURL(/\/account$/)
    }
    await expect(page.getByTestId('login-form')).toHaveCount(0)
    await expect(page).not.toHaveURL(/\/manage\/routes/)
})

test('back on the login page skips a page that needs sign-in', async ({
    page,
}) => {
    await gotoSettled(page, '/auth/login?redirect=/logbook')
    await page.evaluate(() =>
        history.replaceState({ ...history.state, back: '/logbook' }, ''),
    )
    await page.getByTestId('auth-back').click()
    await page.waitForURL((url) => url.pathname === '/')
})
