import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { projectLanguage, translate } from '../../support/i18n'

test('reset request asks for the account email', async ({ page }, testInfo) => {
    const language = projectLanguage(testInfo)
    await gotoSettled(page, '/auth/login')
    await page.getByTestId('login-goto-reset').click()
    await expect(page.getByTestId('reset-form')).toBeVisible()
    await expect(page.getByTestId('auth-subtitle')).toHaveText(
        translate(language, 'account.reset_hint'),
    )
})

test('reset link page asks for a new password', async ({ page }, testInfo) => {
    const language = projectLanguage(testInfo)
    await gotoSettled(page, '/auth/confirm-password-reset/looks-like-a-token')
    await expect(page.getByTestId('auth-subtitle')).toHaveText(
        translate(language, 'account.newPasswordHint'),
    )
})

test('footer shows the server status in the active locale', async ({
    page,
}, testInfo) => {
    const language = projectLanguage(testInfo)
    await gotoSettled(page, gymPath('/'))
    await page.getByTestId('footer-info').click()
    await expect(page.getByTestId('footer-health')).toHaveText(
        translate(language, 'notifications.success.health'),
    )
})
