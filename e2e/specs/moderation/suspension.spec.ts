import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { openCase } from '../../support/moderation'
import { fillLogin } from '../../support/auth'
import { getMe, getPlatformUser, suspendUser } from '../../support/api'

test('a platform admin suspends a person for good and lifts it again', async ({
    platformPage,
    page,
    api,
    createUser,
}) => {
    const person = await createUser('user', 'suspended')

    await gotoSettled(platformPage, '/platform/users')
    await platformPage.getByTestId('filter-search').fill(person.email)
    const row = platformPage.getByTestId(`platform-user-${person.id}`)
    await row.getByTestId('platform-user-suspend').click()
    await platformPage.getByTestId('platform-suspend-permanent').click()
    await platformPage
        .getByTestId('platform-suspend-reason')
        .fill('Repeated spam.')
    await platformPage.getByTestId('platform-suspend-confirm').click()
    await expect(row.getByTestId('platform-user-suspended-badge')).toBeVisible()
    expect((await getPlatformUser(api, person.id)).suspended_until).toMatch(
        /^9999-/,
    )

    await gotoSettled(page, '/auth/login')
    await fillLogin(page, person.email, person.password)
    await page.getByTestId('login-submit').click()
    await expect(
        page.getByTestId('global-snackbar-message').last(),
    ).toContainText(/suspended/i)

    await row.getByTestId('platform-user-suspend').click()
    await platformPage.getByTestId('platform-suspend-lift').click()
    await expect(row.getByTestId('platform-user-suspended-badge')).toHaveCount(
        0,
    )

    await fillLogin(page, person.email, person.password)
    await page.getByTestId('login-submit').click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'))
})

test('an open session stops working the moment the person is suspended', async ({
    platformPage,
    createUser,
    pageAs,
}) => {
    const person = await createUser('user', 'kicked')
    const personPage = await pageAs(person)
    await gotoSettled(personPage, '/logbook')
    const personApi = await apiOf(personPage)
    expect((await getMe(personApi)).id).toBe(person.id)

    await suspendUser(await apiOf(platformPage), person.id, {
        permanent: true,
        reason: 'Abuse.',
    })

    await expect(getMe(personApi)).rejects.toMatchObject({ status: 401 })
    await expect(personApi.post('/auth/refresh')).rejects.toBeTruthy()
})

test('the 7-day preset suspends for a week and needs a reason', async ({
    platformPage,
    api,
    createUser,
}) => {
    const person = await createUser('user', 'week')
    await gotoSettled(platformPage, '/platform/users')
    await platformPage.getByTestId('filter-search').fill(person.email)
    const row = platformPage.getByTestId(`platform-user-${person.id}`)
    await row.getByTestId('platform-user-suspend').click()
    await platformPage.getByTestId('platform-suspend-week').click()
    const confirm = platformPage.getByTestId('platform-suspend-confirm')
    await expect(confirm).toBeDisabled()
    await platformPage.getByTestId('platform-suspend-reason').fill('   ')
    await expect(confirm).toBeDisabled()
    await platformPage.getByTestId('platform-suspend-reason').fill('Spam.')
    await confirm.click()

    await expect(row.getByTestId('platform-user-suspended-badge')).toBeVisible()
    const until = new Date(
        String((await getPlatformUser(api, person.id)).suspended_until).replace(
            ' ',
            'T',
        ),
    ).getTime()
    const week = Date.now() + 7 * 86_400_000
    expect(Math.abs(until - week)).toBeLessThan(3_600_000)
})

test('platform admins cannot be suspended from a case', async ({
    platformPage,
    route,
    testPrefix,
}) => {
    await gotoSettled(platformPage, gymPath('/'))
    const text = `${testPrefix}-by-admin`
    await createComment(platformPage, route.id, text)

    await openCase(platformPage, text, '/platform/moderation', 'all')
    await platformPage
        .locator('[data-testid="moderation-author-suspend"]:visible')
        .click()
    await expect(
        platformPage.getByTestId('global-snackbar-message').last(),
    ).toContainText(/cannot be suspended/i)
    await expect(
        platformPage.getByTestId('platform-suspend-dialog'),
    ).toHaveCount(0)
})
