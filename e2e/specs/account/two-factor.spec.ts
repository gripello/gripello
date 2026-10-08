import { createHmac } from 'node:crypto'
import PocketBase from 'pocketbase'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { fillLogin, signInAs } from '../../support/auth'
import { authAsSuperuser, ensureUser, getRoleIds } from '../../support/seed'

const PB_URL = process.env.E2E_PB_URL || 'https://localhost'
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function totp(secret: string, offset = 0) {
    const bits = [...secret.replace(/\s/g, '')]
        .map((char) => BASE32.indexOf(char).toString(2).padStart(5, '0'))
        .join('')
    const key = Buffer.from(
        bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
    )
    const counter = Buffer.alloc(8)
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset))
    const hash = createHmac('sha1', key).update(counter).digest()
    const start = hash[hash.length - 1]! & 0x0f
    return String((hash.readUInt32BE(start) & 0x7fffffff) % 1_000_000).padStart(
        6,
        '0',
    )
}

async function typeCode(page: Page, testId: string, code: string) {
    await page.getByTestId(testId).locator('input').first().click()
    await page.keyboard.type(code)
}

async function confirmPassword(page: Page, password: string) {
    await page.getByTestId('two-factor-password').fill(password)
    await page.getByTestId('two-factor-password-confirm').click()
}

test.describe('account security', () => {
    let root: PocketBase
    let user: { id: string; email: string; password: string }

    test.beforeEach(async ({ testPrefix }) => {
        root = new PocketBase(PB_URL)
        await authAsSuperuser(root)
        const roleIds = await getRoleIds(root)
        user = await ensureUser(root, roleIds.user, 'user', `${testPrefix}-2fa`)
    })

    test.afterEach(async () => {
        await root
            .collection('users')
            .delete(user.id)
            .catch(() => {})
    })

    test('asks for the authenticator code after the password', async ({
        page,
    }) => {
        await signInAs(page, user.email, user.password)
        await gotoSettled(page, '/account/settings?tab=security')
        await page.getByTestId('two-factor-totp-setup').click()
        await confirmPassword(page, user.password)
        const secret = await page.getByTestId('two-factor-secret').innerText()
        await typeCode(page, 'two-factor-setup-code', totp(secret, -1))
        await expect(
            page.getByTestId('two-factor-codes').locator('li'),
        ).toHaveCount(10)
        await page.getByTestId('two-factor-codes-done').click()

        await page.context().clearCookies()
        await gotoSettled(page, '/auth/login')
        await fillLogin(page, user.email, user.password)
        await page.getByTestId('login-submit').click()
        await typeCode(page, 'two-factor-code', totp(secret))
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
        await gotoSettled(page, '/auth/login')
        await page.getByTestId('login-passkey').click()
        await expect(page).not.toHaveURL(/\/auth\/login/)
    })
})
