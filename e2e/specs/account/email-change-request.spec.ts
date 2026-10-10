import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

async function openProfileSettings(page: Page) {
    await gotoSettled(page, '/account/settings')
    await expect(page.getByTestId('profile-email')).toBeVisible()
}

test('requests an email change instead of writing the address', async ({
    createUser,
    pageAs,
    testPrefix,
}) => {
    const page = await pageAs(await createUser())
    await openProfileSettings(page)

    const newEmail = `${testPrefix}-newaddr@gripello.test`
    await page.getByTestId('profile-email').fill(newEmail)

    const changeRequest = page.waitForRequest((req) =>
        req.url().includes('/api/auth/email-change/request'),
    )
    const patch = page.waitForRequest(
        (req) =>
            req.method() === 'PATCH' &&
            new URL(req.url()).pathname === '/api/me',
    )

    await page.getByTestId('profile-save').click()

    const patchReq = await patch
    expect(await patchReq.postData()).not.toContain(newEmail)

    const req = await changeRequest
    expect(req.postDataJSON()?.newEmail).toBe(newEmail)
})

test('reports a failed confirmation mail without claiming the change', async ({
    userPage: page,
    testPrefix,
}) => {
    await page.route('**/api/auth/email-change/request', (route) =>
        route.abort('failed'),
    )

    await openProfileSettings(page)
    await page
        .getByTestId('profile-email')
        .fill(`${testPrefix}-failaddr@gripello.test`)
    await page.getByTestId('profile-save').click()

    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
})

test('blocks saving a malformed email address', async ({ userPage: page }) => {
    await openProfileSettings(page)
    await page.getByTestId('profile-email').fill('not-an-email')
    await page.getByTestId('profile-save').click()

    await expect(page.getByTestId('profile-email')).toBeVisible()
})
