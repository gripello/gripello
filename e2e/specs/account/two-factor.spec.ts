import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { fillLogin, signInAs, totp, typeCode } from '../../support/auth'

async function confirmPassword(page: Page, password: string) {
    await page.getByTestId('two-factor-password').fill(password)
    await page.getByTestId('two-factor-password-confirm').click()
}

test.describe('account security', () => {
    let user: { id: string; email: string; password: string }

    test.beforeEach(async ({ createUser }) => {
        user = await createUser('user', '2fa')
    })

    test('asks for the authenticator code after the password', async ({
        page,
    }) => {
        await signInAs(page, user.email, user.password)
        await gotoSettled(page, '/account/settings?tab=security')
        await page.getByTestId('two-factor-totp-setup').click()
        await confirmPassword(page, user.password)
        const secret = await page.getByTestId('two-factor-secret').innerText()
        await typeCode(page, 'two-factor-setup-code', totp(secret))
        await expect(
            page.getByTestId('two-factor-codes').locator('li'),
        ).toHaveCount(10)
        const download = page.waitForEvent('download')
        await page.getByTestId('two-factor-codes-download').click()
        const file = await download
        expect(file.suggestedFilename()).toBe('gripello-recovery-codes.txt')
        const codes = (await readFile((await file.path())!, 'utf8')).trim()
        expect(codes.split('\n')).toHaveLength(10)
        await page.getByTestId('two-factor-codes-done').click()

        await page.context().clearCookies()
        await gotoSettled(page, '/auth/login')
        await fillLogin(page, user.email, user.password)
        await page.getByTestId('login-submit').click()
        await typeCode(page, 'two-factor-code', totp(secret, 1))
        await expect(page).not.toHaveURL(/\/auth\/login/)
    })

    test('signs out another device', async ({ page, browser }) => {
        const other = await browser.newContext()
        const otherPage = await other.newPage()
        try {
            await gotoSettled(otherPage, '/auth/login')
            await fillLogin(otherPage, user.email, user.password)
            await otherPage.getByTestId('login-submit').click()
            await expect(otherPage).not.toHaveURL(/\/auth\/login/)

            await gotoSettled(page, '/auth/login')
            await fillLogin(page, user.email, user.password)
            await page.getByTestId('login-submit').click()
            await expect(page).not.toHaveURL(/\/auth\/login/)
            await gotoSettled(page, '/account/settings?tab=security')
            await expect(page.getByTestId('session-row')).toHaveCount(2)
            await page.getByTestId('session-revoke').click()
            await expect(page.getByTestId('session-row')).toHaveCount(1)

            await gotoSettled(otherPage, '/account')
            await expect(otherPage.getByTestId('me-guest')).toBeVisible()
        } finally {
            await other.close()
        }
    })

    test('registers a passkey and signs in with it', async ({
        page,
        browserName,
    }) => {
        test.skip(
            browserName !== 'chromium',
            'virtual authenticator is Chromium-only',
        )
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('WebAuthn.enable')
        await cdp.send('WebAuthn.addVirtualAuthenticator', {
            options: {
                protocol: 'ctap2',
                transport: 'internal',
                hasResidentKey: true,
                hasUserVerification: true,
                isUserVerified: true,
            },
        })

        await signInAs(page, user.email, user.password)
        await gotoSettled(page, '/account/settings?tab=security')
        await page.getByTestId('two-factor-passkey-add').click()
        await confirmPassword(page, user.password)
        await page.getByTestId('two-factor-codes-done').click()
        await expect(page.getByTestId('two-factor-passkey')).toHaveCount(1)

        await page.context().clearCookies()
        // the virtual authenticator answers the login page's autofill request without a click
        await page.goto('/auth/login')
        await expect(page).not.toHaveURL(/\/auth\/login/)
    })
})
