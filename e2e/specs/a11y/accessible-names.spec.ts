import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

test('command palette dialog and search field are named', async ({ page }) => {
    await gotoSettled(page, gymPath('/'))
    await page.getByTestId('command-palette-open').click()
    await expect(
        page.getByRole('dialog', { name: 'Search' }).first(),
    ).toBeVisible()
    await expect(page.getByTestId('command-palette-input')).toHaveAttribute(
        'aria-label',
        /Route name/,
    )
})

test('dialog shell is named by its title', async ({ adminPage: page }) => {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-create-open').click()
    await expect(
        page.getByRole('dialog', { name: 'Create route' }),
    ).toBeVisible()
})

test('settings asset upload zone opens the file picker from the keyboard', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/settings')
    const zone = page.getByTestId('settings-asset-logo')
    await expect(zone).toHaveJSProperty('tagName', 'BUTTON')
    await expect(zone).toHaveAttribute('aria-label', /Click to upload/)
    await expect(zone.locator('button, [role="button"]')).toHaveCount(0)
    await zone.focus()
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    await chooser
})

test('analytics charts expose a text description', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/analytics')
    await expect(page.getByTestId('analytics-chart-grades')).toHaveAttribute(
        'aria-label',
        /.+/,
    )
})
