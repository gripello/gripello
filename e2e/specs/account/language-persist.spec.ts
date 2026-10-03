import { test, expect } from '../../support/fixtures'
import { fillLogin } from '../../support/auth'
import { gotoSettled, gymPath } from '../../support/nav'

test('the chosen language is saved on the user and restored on the next login', async ({
    page: secondSession,
    root,
    createUser,
    pageAs,
}) => {
    const user = await createUser()

    const firstSession = await pageAs(user)
    await gotoSettled(firstSession, '/account/settings?tab=preferences')
    await expect(firstSession.locator('html')).toHaveAttribute('lang', 'en')
    await firstSession.getByTestId('profile-language').click()
    await firstSession.getByTestId('profile-language-de').click()
    await expect(firstSession.locator('html')).toHaveAttribute('lang', 'en')
    await firstSession.getByTestId('profile-save').click()
    await expect(firstSession.getByTestId('profile-unsaved')).toHaveCount(0)
    await expect(firstSession.locator('html')).toHaveAttribute('lang', 'de')
    await expect
        .poll(
            async () =>
                (await root.collection('users').getOne(user.id)).language,
        )
        .toBe('de')

    await gotoSettled(secondSession, '/auth/login')
    await fillLogin(secondSession, user.email, user.password)
    await secondSession.getByTestId('login-submit').click()
    await secondSession.waitForURL(
        (url) => !url.pathname.startsWith('/auth/login'),
    )
    await expect(secondSession.locator('html')).toHaveAttribute('lang', 'de')

    const ssrResponse = await secondSession.goto(gymPath('/'))
    expect(await ssrResponse!.text()).toContain('lang="de"')
})
