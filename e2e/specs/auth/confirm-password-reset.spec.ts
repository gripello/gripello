import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

async function fillNewPassword(page: import('@playwright/test').Page) {
    for (const field of ['password-new', 'password-confirm']) {
        await page.getByTestId(field).fill('NewPassw0rd!123')
    }
}

test('resets the password and sends the user back to sign in', async ({
    page,
}) => {
    await page.route('**/api/auth/password-reset/confirm', (route) =>
        route.fulfill({ status: 204, body: '' }),
    )

    await gotoSettled(page, '/auth/confirm-password-reset/looks-like-a-token')
    await fillNewPassword(page)
    await page.getByTestId('confirm-reset-submit').click()

    await expect(page.getByTestId('reset-done')).toBeVisible()
    await page.getByTestId('reset-goto-login').click()
    await page.waitForURL(/\/auth\/login/)
})

test('keeps the form and notifies on a non-token error', async ({ page }) => {
    await page.route('**/api/auth/password-reset/confirm', (route) =>
        route.fulfill({
            status: 400,
            json: { message: 'Password too weak', data: {} },
        }),
    )

    await gotoSettled(page, '/auth/confirm-password-reset/looks-like-a-token')
    await fillNewPassword(page)
    await page.getByTestId('confirm-reset-submit').click()

    const snackbar = page.getByTestId('global-snackbar').last()
    await expect(snackbar).toContainText('Something went wrong')
    await expect(snackbar).not.toContainText('Password too weak')
    await expect(page.getByTestId('confirm-reset-submit')).toBeVisible()
})
