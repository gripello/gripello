import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('shows the invalid-link state for a bogus verification token', async ({
    page,
}) => {
    await gotoSettled(page, '/auth/confirm-verification/not-a-real-token')
    await expect(page.getByTestId('verify-invalid')).toBeVisible()
})

test('confirms a verification token and offers sign-in', async ({ page }) => {
    await page.route('**/api/auth/verification/confirm', (route) =>
        route.fulfill({ status: 204, body: '' }),
    )

    await gotoSettled(page, '/auth/confirm-verification/looks-like-a-token')
    await expect(page.getByTestId('verify-done')).toBeVisible()

    await page.getByTestId('verify-goto-login').click()
    await page.waitForURL(/\/auth\/login/)
})
