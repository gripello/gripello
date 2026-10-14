import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { E2E_GYM_SLUG } from '../../support/seed'
import { updateGym, updateSettings } from '../../support/api'

const blocks = (page: Page) => page.locator('.ProseMirror > *')

async function writeOwnSection(page: Page, title: string, text: string) {
    await expect(
        page.locator('.ProseMirror[contenteditable="true"]'),
    ).toBeVisible()
    await blocks(page)
        .first()
        .click({ position: { x: 200, y: 10 } })
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Section title' }).click()
    await page.keyboard.type(title)
    await page.keyboard.press('Enter')
    await page.keyboard.type(text)
    await expect(blocks(page).nth(1)).toHaveText(title)
}

test('gym admins move sections and write their own privacy text', async ({
    adminPage: page,
    adminApi,
}) => {
    try {
        await gotoSettled(page, '/admin/settings?section=privacy')
        await expect(blocks(page).nth(2)).toContainText('Server logs')

        await blocks(page).nth(2).hover()
        await page.getByTestId('settings-privacy-grip').focus()
        await page.keyboard.press('ArrowUp')
        await expect(blocks(page).nth(1)).toContainText('Server logs')

        const title = `E2E cameras ${Date.now()}`
        await writeOwnSection(page, title, 'We film the entrance of {gym}.')

        await page
            .getByTestId('settings-privacy-mode')
            .getByText('Preview')
            .click()
        await expect(
            page.getByTestId('settings-privacy-preview'),
        ).toContainText('We film the entrance of E2E')

        await page.getByTestId('settings-save').click()
        await expect(page.getByTestId('settings-save')).toBeHidden()

        await gotoSettled(page, gymPath('/privacy'))
        const headings = page.locator('[data-testid="gym-privacy-page"] h2')
        await expect(headings.nth(2)).toHaveText(title)
        await expect(page.getByTestId('privacy-custom')).toContainText(
            'We film the entrance of E2E',
        )
        await expect(headings.nth(3)).toHaveText('Server logs')
        await expect(page.getByTestId('privacy-rights')).toBeVisible()
    } finally {
        await updateGym(adminApi, E2E_GYM_SLUG, { privacy_doc: null })
    }
})

test('sections are removed with the button, the controller never', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/settings?section=privacy')
    await blocks(page).first().hover()
    await expect(page.getByTestId('settings-privacy-grip')).toBeVisible()
    await expect(page.getByTestId('settings-privacy-remove')).toHaveCount(0)

    await expect(blocks(page).nth(2)).toContainText('Server logs')
    await blocks(page).nth(2).hover()
    await page.getByTestId('settings-privacy-remove').click()
    await expect(blocks(page).nth(2)).not.toContainText('Server logs')
    await expect(page.getByTestId('settings-privacy-missing')).toHaveCount(0)
})

test('platform admins edit the platform privacy page', async ({
    platformPage: page,
    api,
}) => {
    try {
        await gotoSettled(page, '/platform/settings?section=privacy')
        const title = `E2E platform note ${Date.now()}`
        await writeOwnSection(page, title, 'Operated in the EU.')
        await page.getByTestId('platform-settings-save').click()
        await expect(page.getByTestId('platform-settings-unsaved')).toBeHidden()

        await gotoSettled(page, '/privacy')
        await expect(page.getByTestId('privacy-custom')).toContainText(title)
    } finally {
        await updateSettings(api, { privacy_doc: null })
    }
})
