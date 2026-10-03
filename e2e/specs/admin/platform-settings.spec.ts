import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { PLATFORM_SETTINGS_ID } from '../../../shared/utils/platform'

async function setRegistration(page: Page, allowed: boolean) {
    const toggle = page.getByTestId('platform-settings-allow-registration')
    await expect(toggle).toHaveAttribute('aria-checked', String(!allowed))
    await toggle.click()
    await page.getByTestId('platform-settings-save').click()
    await expect(page.getByTestId('platform-settings-unsaved')).toBeHidden()
}

test('platform admin opens and closes registration', async ({
    adminPage,
    page,
    root,
}) => {
    const settings = root.collection('settings')
    const original = await settings.getOne(PLATFORM_SETTINGS_ID, {
        requestKey: null,
    })
    await settings.update(PLATFORM_SETTINGS_ID, { allow_registration: false })
    try {
        await gotoSettled(adminPage, '/platform/settings')
        await setRegistration(adminPage, true)
        await expect
            .poll(
                async () =>
                    (
                        await settings.getOne(PLATFORM_SETTINGS_ID, {
                            requestKey: null,
                        })
                    ).allow_registration,
            )
            .toBe(true)
        await gotoSettled(page, '/auth/login')
        await expect(page.getByTestId('login-goto-register')).toBeVisible()

        await setRegistration(adminPage, false)
        await gotoSettled(page, '/auth/login')
        await expect(page.getByTestId('login-goto-register')).toHaveCount(0)
    } finally {
        await settings.update(PLATFORM_SETTINGS_ID, {
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
