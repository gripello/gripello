import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('the sidebar is a navigation landmark named after the gym', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await expect(
        page.getByRole('navigation', { name: 'E2E Gym' }).first(),
    ).toBeVisible()
})

test('dialogs expose a role and are keyboard-dismissible', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-create-open').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()
})

test('icon-only close buttons have an accessible name', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('route-details-open').first().click()
    await expect(page.getByRole('button', { name: /close/i })).toBeVisible()
})

test('a blocked-submit validation error is exposed to assistive tech', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-create-open').click()
    await page.getByTestId('route-form-submit').click()

    const name = page.getByTestId('route-form-name')
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveAccessibleDescription(/required/i)
})
