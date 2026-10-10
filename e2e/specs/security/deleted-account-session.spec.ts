import { test, expect } from '../../support/fixtures'
import { gymPath } from '../../support/nav'
import { authCookieValue, login } from '../../support/auth'
import { deletePlatformUser } from '../../support/api'

test('a leftover session of a deleted account still renders the site', async ({
    page,
    baseURL,
    api,
    createUser,
}) => {
    const ghost = await createUser('user', 'ghost')
    const cookie = authCookieValue(await login(ghost.email, ghost.password))
    await deletePlatformUser(api, ghost.id)

    await page
        .context()
        .addCookies([{ name: 'pb_auth', value: cookie, url: baseURL! }])

    const response = await page.goto(gymPath('/'))
    expect(response?.status()).toBe(200)
    await expect(page.getByTestId('nav-login')).toBeVisible()
})
