import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('blocks submit until the password is filled in', async ({ page }) => {
    await gotoSettled(page, '/auth/confirm-email-change/looks-like-a-token')
    await expect(page.getByTestId('email-change-form')).toBeVisible()
    await expect(page.getByTestId('email-change-submit')).toBeDisabled()
})

test('shows the invalid-link state for a bogus email-change token', async ({
    page,
}) => {
    await gotoSettled(page, '/auth/confirm-email-change/not-a-real-token')
    await page.getByTestId('email-change-password').fill('E2ePassw0rd!')

    const submit = page.getByTestId('email-change-submit')
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(page.getByTestId('email-change-invalid')).toBeVisible()
})

test('confirms an email change and sends the user back to sign in', async ({
    page,
}) => {
    await page.route('**/api/auth/email-change/confirm', (route) =>
        route.fulfill({ status: 204, body: '' }),
    )

    await gotoSettled(page, '/auth/confirm-email-change/looks-like-a-token')
    await page.getByTestId('email-change-password').fill('E2ePassw0rd!')
    await page.getByTestId('email-change-submit').click()

    await expect(page.getByTestId('email-change-done')).toBeVisible()
    await page.getByTestId('email-change-goto-login').click()
    await page.waitForURL(/\/auth\/login/)
})
