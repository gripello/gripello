import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, reloadSettled } from '../../support/nav'
import {
    ApiError,
    apiAs,
    getBlocklists,
    getMe,
    getSettings,
    updateBlocklists,
    updateSettings,
} from '../../support/api'

async function setRegistration(page: Page, allowed: boolean) {
    const toggle = page.getByTestId('platform-settings-allow-registration')
    await expect(toggle).toHaveAttribute('aria-checked', String(!allowed))
    await toggle.click()
    await page.getByTestId('platform-settings-save').click()
    await expect(page.getByTestId('platform-settings-unsaved')).toBeHidden()
}

test('platform admin opens and closes registration', async ({
    platformPage: adminPage,
    page,
    api,
}) => {
    const original = await getSettings(api)
    await updateSettings(api, { allow_registration: false })
    try {
        await gotoSettled(adminPage, '/platform/settings')
        await setRegistration(adminPage, true)
        await expect
            .poll(async () => (await getSettings(api)).allow_registration)
            .toBe(true)
        await gotoSettled(page, '/auth/login')
        await expect(page.getByTestId('login-goto-register')).toBeVisible()

        await setRegistration(adminPage, false)
        await gotoSettled(page, '/auth/login')
        await expect(page.getByTestId('login-goto-register')).toHaveCount(0)
    } finally {
        await updateSettings(api, {
            allow_registration: original.allow_registration,
        })
    }
})

test('climbers are sent away from the platform settings', async ({
    userPage,
}) => {
    await gotoSettled(userPage, '/platform/settings', /^https?:\/\/[^/]+\/$/)
    await expect(
        userPage.getByTestId('platform-settings-allow-registration'),
    ).toHaveCount(0)
})

// Catches: blocklist edits that never persist, or saved entries the account checks ignore.
test('platform admin blocks an e-mail domain and protects a name', async ({
    platformPage: adminPage,
    api,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const original = await getBlocklists(api)
    const domain = `${testPrefix}.blocked.test`
    const term = `rsv${testPrefix.replace(/\D/g, '')}`
    try {
        await test.step('admin saves both lists', async () => {
            await gotoSettled(
                adminPage,
                '/platform/settings?section=blocklists',
            )
            const emails = adminPage.getByTestId('platform-blocklist-emails')
            const names = adminPage.getByTestId('platform-blocklist-names')
            await expect(emails).toHaveValue(original.blocked_emails.join('\n'))
            await emails.fill([...original.blocked_emails, domain].join('\n'))
            await names.fill([...original.protected_names, term].join('\n'))
            await adminPage.getByTestId('platform-settings-save').click()
            await expect(
                adminPage.getByTestId('platform-settings-unsaved'),
            ).toBeHidden()

            const saved = await getBlocklists(api)
            expect(saved.blocked_emails).toContain(domain)
            expect(saved.protected_names).toContain(term)
            await reloadSettled(adminPage)
            await expect(emails).toHaveValue(
                new RegExp(domain.replace(/\./g, '\\.')),
            )
            await expect(names).toHaveValue(new RegExp(term))
        })

        const climber = await createUser('user', 'blocked')
        const climberApi = await apiAs(climber)
        const before = await getMe(climberApi)
        const page = await pageAs(climber)
        const toast = page.getByTestId('global-snackbar-message')

        await test.step('a protected surname is refused', async () => {
            await gotoSettled(page, '/account/settings')
            await page.getByTestId('profile-lastname').fill(`X${term}`)
            await page.getByTestId('profile-save').click()
            await expect(toast).toContainText('This name is reserved.')
            expect((await getMe(climberApi)).name).toBe(before.name)
        })

        await test.step('an address on the blocked domain is refused', async () => {
            await gotoSettled(page, '/account/settings')
            await page.getByTestId('profile-email').fill(`me@${domain}`)
            const request = page.waitForResponse((response) =>
                response.url().includes('/api/auth/email-change/request'),
            )
            await page.getByTestId('profile-save').click()
            expect((await request).status()).toBe(400)
            await expect(toast.last()).toContainText(
                "This e-mail address can't be used.",
            )
            expect((await getMe(climberApi)).email).toBe(before.email)
        })
    } finally {
        await updateBlocklists(api, {
            blocked_emails: original.blocked_emails,
            allowed_emails: original.allowed_emails,
            protected_names: original.protected_names,
        })
    }
})

// Catches: the blocklist endpoints opening up to gym staff.
test('gym admins can neither read nor change the blocklists', async ({
    adminApi,
}) => {
    for (const call of [
        () => getBlocklists(adminApi),
        () =>
            updateBlocklists(adminApi, {
                blocked_emails: [],
                allowed_emails: [],
                protected_names: [],
            }),
    ]) {
        const error = await call().catch((e: unknown) => e)
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).status).toBe(403)
    }
})
