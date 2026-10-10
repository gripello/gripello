import { test, expect } from '../../support/fixtures'
import { fillLogin } from '../../support/auth'
import { gotoSettled } from '../../support/nav'
import { projectLanguage, translate } from '../../support/i18n'

test('login brand eyebrow is translated', async ({ page }, testInfo) => {
    const language = projectLanguage(testInfo)
    await gotoSettled(page, '/auth/login')
    await expect(page.getByTestId('auth-brand-eyebrow')).toHaveText(
        translate(language, 'account.eyebrowBrand'),
    )
})

test('captcha failures show a translated message instead of the server text', async ({
    page,
}, testInfo) => {
    const language = projectLanguage(testInfo)
    await page.route('**/api/auth/login', (route) =>
        route.fulfill({
            status: 400,
            contentType: 'application/json',
            json: {
                status: 400,
                message: 'Captcha verification failed.',
                data: {},
            },
        }),
    )

    await gotoSettled(page, '/auth/login')
    await fillLogin(page, 'someone', 'whatever1')
    await page.getByTestId('login-submit').click()

    const snackbar = page.getByTestId('global-snackbar').last()
    await expect(snackbar).toContainText(
        translate(language, 'notifications.error.captcha'),
    )
    await expect(snackbar).not.toContainText('Captcha verification failed')
})

test('a wrong password on email change shows a translated message', async ({
    page,
}, testInfo) => {
    const language = projectLanguage(testInfo)
    await page.route('**/api/auth/email-change/confirm', (route) =>
        route.fulfill({
            status: 400,
            contentType: 'application/json',
            json: {
                status: 400,
                message: 'Failed to authenticate.',
                data: {
                    password: {
                        code: 'validation_invalid_password',
                        message: 'Missing or invalid auth record password.',
                    },
                },
            },
        }),
    )

    await gotoSettled(page, '/auth/confirm-email-change/looks-like-a-token')
    await page.getByTestId('email-change-password').fill('E2ePassw0rd!')
    await page.getByTestId('email-change-submit').click()

    const snackbar = page.getByTestId('global-snackbar').last()
    await expect(snackbar).toContainText(
        translate(language, 'account.wrongOldPassword'),
    )
    await expect(snackbar).not.toContainText('Failed to authenticate')
})
