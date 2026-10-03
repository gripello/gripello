import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { fillLogin } from '../../support/auth'
import { gotoSettled } from '../../support/nav'
import { waitForMail, linkPath, mailbox, mailCount } from '../../support/mail'
import PocketBase from 'pocketbase'
import { PLATFORM_SETTINGS_ID } from '../../../shared/utils/platform'

const PB_URL = process.env.E2E_PB_URL || 'https://localhost'
const PASSWORD = 'E2eSignup!123'
const VERIFY_LINK = /https?:\/\/[^"'\s]*\/auth\/confirm-verification\/[^"'\s]+/

async function registrationAllowed(root: PocketBase) {
    const settings = await root
        .collection('settings')
        .getOne(PLATFORM_SETTINGS_ID, { requestKey: null })
    return settings.allow_registration
}

async function setRegistration(root: PocketBase, allowed: boolean) {
    await root
        .collection('settings')
        .update(PLATFORM_SETTINGS_ID, { allow_registration: allowed })
}

function signup(email: string, username: string, extra = {}) {
    return new PocketBase(PB_URL).collection('users').create({
        email,
        username,
        password: PASSWORD,
        passwordConfirm: PASSWORD,
        ...extra,
    })
}

async function signIn(page: Page, email: string) {
    await fillLogin(page, email, PASSWORD)
    await page.getByTestId('login-submit').click()
}

async function expectRejected(request: Promise<unknown>) {
    const error = (await request.catch((err) => err)) as { status?: number }
    expect(error.status).toBeGreaterThanOrEqual(400)
    expect(error.status).toBeLessThan(500)
}

test('closed registration hides the link and rejects sign-ups', async ({
    page,
    root,
    testPrefix,
}) => {
    await setRegistration(root, false)

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
    root,
    testPrefix,
}) => {
    await setRegistration(root, true)
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
            response.url().includes('/api/collections/users/records') &&
            response.request().method() === 'POST',
    )
    const verification = page.waitForResponse((response) =>
        response.url().includes('/request-verification'),
    )
    await page.getByTestId('register-submit').click()
    expect((await signup).ok()).toBe(true)
    expect((await verification).ok()).toBe(true)
    await expect(page.getByTestId('login-form')).toBeVisible()

    const created = await root
        .collection('users')
        .getFirstListItem(`email = "${email}"`, { requestKey: null })
    expect(created.verified).toBe(false)
    const staff = await root.collection('memberships').getList(1, 1, {
        filter: root.filter('user = {:id}', { id: created.id }),
        requestKey: null,
    })
    expect(staff.totalItems).toBe(0)

    const mail = await waitForMail(page, email, { subject: /verify/i })
    await gotoSettled(page, linkPath(mail, VERIFY_LINK))
    await expect(page.getByTestId('verify-done')).toBeVisible()

    await gotoSettled(page, '/auth/login')
    await signIn(page, email)
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'))
})

test('an unverified climber resends the verification mail from the sign-in page', async ({
    page,
    root,
    testPrefix,
}) => {
    const email = mailbox(testPrefix, 'resend')
    await root.collection('users').create({
        email,
        username: `${testPrefix}resend`.replace(/-/g, ''),
        password: PASSWORD,
        passwordConfirm: PASSWORD,
    })
    expect(await mailCount(page, email)).toBe(0)

    await gotoSettled(page, '/auth/login')
    await signIn(page, email)
    await expect(page.getByTestId('login-unverified')).toBeVisible()
    await page.getByTestId('login-resend-verification').click()
    await expect(page.getByTestId('reset-email')).toHaveValue(email)
    await page.getByTestId('reset-submit').click()
    await expect(page.getByTestId('login-form')).toBeVisible()

    const mail = await waitForMail(page, email, { subject: /verify/i })
    await gotoSettled(page, linkPath(mail, VERIFY_LINK))
    await expect(page.getByTestId('verify-done')).toBeVisible()
})
