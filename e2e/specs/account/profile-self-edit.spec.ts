import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test.describe('self-service profile', () => {
    test('edits own name and sees it reflected after save', async ({
        createUser,
        pageAs,
        testPrefix,
    }) => {
        const page = await pageAs(await createUser())
        await gotoSettled(page, '/account/settings')

        const newLastname = `${testPrefix}-lastname`
        await page.getByTestId('profile-lastname').fill(newLastname)
        const saved = page.waitForResponse(
            (res) =>
                res.request().method() === 'PATCH' &&
                new URL(res.url()).pathname === '/api/me',
        )
        await page.getByTestId('profile-save').click()
        expect((await saved).ok()).toBe(true)

        await expect(page.getByTestId('global-snackbar-message')).toBeVisible()
        await expect(page.getByTestId('profile-unsaved')).toHaveCount(0)

        await gotoSettled(page, '/account/settings')
        await expect(page.getByTestId('profile-lastname')).toHaveValue(
            newLastname,
        )
    })

    test('rejects a password change with the wrong current password', async ({
        userPage: page,
    }) => {
        await gotoSettled(page, '/account/settings')
        await page.getByTestId('profile-tab-security').click()

        await page.getByTestId('password-old').fill('definitely-wrong')
        await page.getByTestId('password-new').fill('NewPassw0rd!234')
        await page.getByTestId('password-confirm').fill('NewPassw0rd!234')

        await page.getByTestId('profile-save').click()

        await expect(page.getByTestId('global-snackbar-message')).toContainText(
            /incorrect/i,
        )
        await expect(page.getByTestId('password-old')).toBeVisible()
    })

    test('shows an error and keeps the changes when save fails outright', async ({
        userPage: page,
        testPrefix,
    }) => {
        await gotoSettled(page, '/account/settings')

        await page.route('**/api/me', (route) => route.abort('failed'))

        await page.getByTestId('profile-lastname').fill(`${testPrefix}-fail`)
        await page.getByTestId('profile-save').click()

        await expect(page.getByTestId('global-snackbar-message')).toBeVisible()
        await expect(page.getByTestId('profile-unsaved')).toBeVisible()
    })

    test('cancel discards unsaved changes', async ({ userPage: page }) => {
        await gotoSettled(page, '/account/settings')

        const original = await page.getByTestId('profile-lastname').inputValue()
        await page.getByTestId('profile-lastname').fill('should-not-persist')
        await page.getByTestId('profile-cancel').click()
        await expect(page.getByTestId('profile-lastname')).toHaveValue(original)

        await gotoSettled(page, '/account/settings')
        await expect(page.getByTestId('profile-lastname')).toHaveValue(original)
    })
})

test('does not flag unsaved changes on an untouched profile', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/account/settings')
    await page.getByTestId('profile-tab-security').click()
    await page
        .locator('input[autocomplete="current-password"]')
        .fill('autofilled-by-password-manager')
    await page.getByTestId('profile-tab-profile').click()
    await expect(page.getByTestId('profile-unsaved')).toHaveCount(0)
})

test('lists languages by code instead of emoji flags', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/account/settings?tab=preferences')
    await page.getByTestId('profile-language').click()
    const german = page.getByTestId('profile-language-de')
    await expect(german).toContainText('DE')
    await expect(german).not.toHaveText(/[\u{1F1E6}-\u{1F1FF}]/u)
})
