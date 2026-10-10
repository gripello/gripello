import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { fillLogin } from '../../support/auth'
import { gotoSettled } from '../../support/nav'
import { waitForMail, linkPath, mailbox, mailCount } from '../../support/mail'
import {
    guestApi,
    setUserFlags,
    updateSettings,
    type Api,
    type PlatformUser,
} from '../../support/api'

const PASSWORD = 'E2eSignup!123'
const VERIFY_LINK = /https?:\/\/[^"'\s]*\/auth\/confirm-verification\/[^"'\s]+/

async function setRegistration(api: Api, allowed: boolean) {
    await updateSettings(api, { allow_registration: allowed })
}

function signup(email: string, username: string) {
    return guestApi().post('/auth/register', {
        email,
        username,
        password: PASSWORD,
        passwordConfirm: PASSWORD,
    })
}

async function platformUser(api: Api, email: string) {
    const { items } = await api.get<{ items: PlatformUser[] }>(
        '/platform/users',
        { q: email },
    )
    return items.find((user) => user.email === email)
}

async function signIn(page: Page, email: string, password = PASSWORD) {
    await fillLogin(page, email, password)
    await page.getByTestId('login-submit').click()
}

async function expectRejected(request: Promise<unknown>) {
    const error = (await request.catch((err) => err)) as { status?: number }
    expect(error.status).toBeGreaterThanOrEqual(400)
    expect(error.status).toBeLessThan(500)
}

test('closed registration hides the link and rejects sign-ups', async ({
    page,
    api,
    testPrefix,
}) => {
    await setRegistration(api, false)

    await gotoSettled(page, '/auth/login')
    await expect(page.getByTestId('login-form')).toBeVisible()
    await expect(page.getByTestId('login-goto-register')).toHaveCount(0)

    await expectRejected(
        signup(
            mailbox(testPrefix, 'closed'),
            `${testPrefix}closed`.replace(/-/g, ''),
        ),
    )
})

test('a climber signs up, verifies the email and signs in', async ({
    page,
    api,
    testPrefix,
}) => {
    await setRegistration(api, true)
    const email = mailbox(testPrefix, 'signup')
    const username = `${testPrefix}signup`.replace(/-/g, '')

    await gotoSettled(page, '/auth/login')
    await page.getByTestId('login-goto-register').click()
    await page.getByTestId('register-username').fill(username)
    await page.getByTestId('register-email').fill(email)
    await page.getByTestId('password-new').fill(PASSWORD)
    await page.getByTestId('password-confirm').fill(PASSWORD)
    const signup = page.waitForResponse(
        (response) =>
            response.url().includes('/api/auth/register') &&
            response.request().method() === 'POST',
    )
    await page.getByTestId('register-submit').click()
    expect((await signup).ok()).toBe(true)
    await expect(page.getByTestId('login-form')).toBeVisible()

    const created = await platformUser(api, email)
    expect(created?.verified).toBe(false)
    expect(created?.memberships).toHaveLength(0)

    const mail = await waitForMail(page, email, { subject: /verify/i })
    await gotoSettled(page, linkPath(mail, VERIFY_LINK))
    await expect(page.getByTestId('verify-done')).toBeVisible()

    await gotoSettled(page, '/auth/login')
    await signIn(page, email)
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'))
})

test('an unverified climber resends the verification mail from the sign-in page', async ({
    page,
    createUser,
}) => {
    const { id, email, password } = await createUser('user', 'resend')
    setUserFlags(id, { verified: false })
    expect(await mailCount(page, email)).toBe(0)

    await gotoSettled(page, '/auth/login')
    await signIn(page, email, password)
    await expect(page.getByTestId('login-unverified')).toBeVisible()
    await page.getByTestId('login-resend-verification').click()
    await expect(page.getByTestId('reset-email')).toHaveValue(email)
    await page.getByTestId('reset-submit').click()
    await expect(page.getByTestId('login-form')).toBeVisible()

    const mail = await waitForMail(page, email, { subject: /verify/i })
    await gotoSettled(page, linkPath(mail, VERIFY_LINK))
    await expect(page.getByTestId('verify-done')).toBeVisible()
})
