import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('submits a password reset request', async ({ page }) => {
    await gotoSettled(page, '/auth/login')
    await page.getByTestId('login-goto-reset').click()
    await page.getByTestId('reset-email').fill('e2e-user@gripello.test')
    await page.getByTestId('reset-submit').click()
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible({
        timeout: 15_000,
    })
})

test('blocks a reset request with an invalid email', async ({ page }) => {
    await gotoSettled(page, '/auth/login')
    await page.getByTestId('login-goto-reset').click()
    await page.getByTestId('reset-email').fill('not-an-email')
    await page.getByTestId('reset-submit').click()

    await expect(page.getByTestId('reset-form')).toBeVisible()
    await expect(page.getByTestId('global-snackbar').last()).toBeHidden()
})

test('shows an error when the reset request fails outright', async ({
    page,
}) => {
    await gotoSettled(page, '/auth/login')
    await page.getByTestId('login-goto-reset').click()
    await page.route('**/api/auth/password-reset/request', (route) =>
        route.abort('failed'),
    )
    await page.getByTestId('reset-email').fill('e2e-user@gripello.test')
    await page.getByTestId('reset-submit').click()
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect(page.getByTestId('reset-form')).toBeVisible()
})

test('shows the invalid-link state for a bogus reset token', async ({
    page,
}) => {
    await gotoSettled(page, '/auth/confirm-password-reset/not-a-real-token')
    await page.getByTestId('password-new').fill('NewPassw0rd!123')
    await page.getByTestId('password-confirm').fill('NewPassw0rd!123')
    const submit = page.getByTestId('confirm-reset-submit')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByTestId('reset-invalid')).toBeVisible()
})
