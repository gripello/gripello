import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { PLATFORM_SETTINGS_ID } from '../../../shared/utils/platform'

test.beforeEach(async ({ root }) => {
    await root
        .collection('settings')
        .update(PLATFORM_SETTINGS_ID, { allow_registration: true })
})

test('the guest register button opens the registration form', async ({
    page,
}) => {
    await gotoSettled(page, '/account')
    await page.getByTestId('me-register').click()

    await page.waitForURL(/\/auth\/login\?.*view=register/)
    await expect(page.getByTestId('register-form')).toBeVisible()
})

test('the register view can be opened directly by url', async ({ page }) => {
    const response = await page.goto('/auth/login?view=register')
    expect(response?.status()).toBe(200)
    await gotoSettled(page, '/auth/login?view=register')
    await expect(page.getByTestId('register-form')).toBeVisible()
})
