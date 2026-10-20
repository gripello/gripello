import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { fillLogin, totp, typeCode } from '../../support/auth'

const target = '/account/settings?tab=privacy#e2e-anchor'

async function expectAtTargetWithoutLoginBehind(page: Page) {
    await expect(page).toHaveURL(target)
    await expect(page.getByTestId('page-hydrated')).toBeAttached()
    await page.goBack()
    await expect(page).not.toHaveURL(/\/auth\/login/)
}

test('signing in from a protected deep link returns to its query and hash', async ({
    page,
    createUser,
}) => {
    const user = await createUser('user', 'return-url')
    await page.goto(target)
    await page.waitForURL(/\/auth\/login/)
    await fillLogin(page, user.email, user.password)
    await page.getByTestId('login-submit').click()

    await expectAtTargetWithoutLoginBehind(page)
})

test('the return URL survives the authenticator step', async ({
    page,
    createUser,
    apiAs,
}) => {
    const user = await createUser('user', 'return-url-2fa')
    const userApi = await apiAs(user)
    const { secret } = await userApi.post<{ secret: string }>(
        '/me/totp/setup',
        { password: user.password },
    )
    await userApi.post('/me/totp', {
        password: user.password,
        secret,
        code: totp(secret),
    })

    await page.goto(target)
    await page.waitForURL(/\/auth\/login/)
    await fillLogin(page, user.email, user.password)
    await page.getByTestId('login-submit').click()
    await typeCode(page, 'two-factor-code', totp(secret, 1))

    await expectAtTargetWithoutLoginBehind(page)
})

test('signing in from the sidebar returns to the route with its hash', async ({
    page,
    route,
    createUser,
}) => {
    const user = await createUser('user', 'return-sidebar')
    const routeUrl = `${gymPath('/route')}?id=${route.id}#reviews`
    await gotoSettled(page, routeUrl)
    await page.getByTestId('sidebar-login').click()
    await page.waitForURL(/\/auth\/login/)
    await fillLogin(page, user.email, user.password)
    await page.getByTestId('login-submit').click()

    await expect(page).toHaveURL(routeUrl)
    await expect(page.getByTestId('tick-open')).toBeVisible()
    await page.goBack()
    await expect(page).not.toHaveURL(/\/auth\/login/)
})
