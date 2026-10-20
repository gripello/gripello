import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { E2E_GYM_SLUG } from '../../support/seed'

test.use({ viewport: { width: 360, height: 740 } })

async function leaveWithUnsavedEdit(
    page: Page,
    prefix: string,
    settingsPath: RegExp,
    exitPath: RegExp,
) {
    await page.goBack()
    await expect(page).toHaveURL(settingsPath)
    await expect(page.getByTestId(`${prefix}-unsaved`)).toBeVisible()

    const discard = page.getByTestId('confirm-dialog')
    await page.goBack()
    await expect(discard).toBeVisible()

    await page.goBack()
    await expect(discard).toBeHidden()
    await expect(page).toHaveURL(settingsPath)
    await expect(page.getByTestId(`${prefix}-unsaved`)).toBeVisible()

    await page.goBack()
    await expect(discard).toBeVisible()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page).toHaveURL(exitPath)
}

test('browser back in platform settings returns to the list, then asks before dropping an edit', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/platform/more')
    await page.getByTestId('platform-more-platform-settings').click()
    await page.waitForURL(/\/platform\/settings$/)

    for (const section of ['links', 'legal']) {
        await page.getByTestId(`platform-settings-drill-${section}`).click()
        await page.waitForURL(new RegExp(`section=${section}`))
        await page.getByTestId('platform-settings-drill-back').click()
        await page.waitForURL(/\/platform\/settings$/)
    }

    await page.getByTestId('platform-settings-drill-access').click()
    await page.waitForURL(/section=access/)
    const retention = page.getByTestId('platform-settings-audit-retention')
    await retention.fill(String(Number(await retention.inputValue()) + 1))

    await leaveWithUnsavedEdit(
        page,
        'platform-settings',
        /\/platform\/settings$/,
        /\/platform\/more$/,
    )
})

test('browser back on a platform gym detail never replays sections and guards an edit', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/platform/gyms')
    await page
        .locator(`[data-testid="platform-gym-link-${E2E_GYM_SLUG}"]:visible`)
        .click()
    await page.waitForURL(/\/platform\/gyms\/[^/?]+$/)
    const detail = new RegExp(`${new URL(page.url()).pathname}$`)

    for (const section of ['members', 'features']) {
        await page.getByTestId(`settings-drill-${section}`).click()
        await page.waitForURL(new RegExp(`section=${section}`))
        await page.getByTestId('settings-drill-back').click()
        await expect(page).toHaveURL(detail)
    }

    await page.getByTestId('settings-drill-organization').click()
    await page.waitForURL(/section=organization/)
    const name = page.getByTestId('settings-org-name')
    await name.fill(`${await name.inputValue()} edited`)

    await leaveWithUnsavedEdit(page, 'settings', detail, /\/platform\/gyms$/)
})
