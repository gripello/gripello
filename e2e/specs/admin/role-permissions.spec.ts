import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, reloadSettled } from '../../support/nav'
import { createRole } from '../../support/seed'

const roleSaved = (page: Page) =>
    page.waitForResponse(
        (res) =>
            res.request().method() === 'PATCH' &&
            res.url().includes('/api/collections/roles/records/'),
    )

test('toggles a permission for a role', async ({
    adminPage: page,
    root,
    testPrefix,
}) => {
    const role = await createRole(root, `${testPrefix}-role`)
    await gotoSettled(page, '/admin/users#roles')
    await page.getByTestId(`role-permissions-row-${role.name}`).click()

    const checkbox = page.getByTestId(
        `role-permissions-${role.name}-manage_users`,
    )
    await expect(checkbox).not.toBeChecked()

    const saved = roleSaved(page)
    await checkbox.click()
    expect((await saved).ok()).toBe(true)
    await expect(checkbox).toBeChecked()

    await reloadSettled(page)
    await expect(page.getByTestId('role-detail')).toContainText(role.name)
    await expect(checkbox).toBeChecked()

    const reverted = roleSaved(page)
    await checkbox.click()
    expect((await reverted).ok()).toBe(true)
    await expect(checkbox).not.toBeChecked()
})

test('shows an error and does not persist the change when the update fails', async ({
    adminPage: page,
    root,
    testPrefix,
}) => {
    const role = await createRole(root, `${testPrefix}-role`)
    await gotoSettled(page, '/admin/users#roles')
    await page.getByTestId(`role-permissions-row-${role.name}`).click()

    const checkbox = page.getByTestId(
        `role-permissions-${role.name}-manage_settings`,
    )
    await expect(checkbox).not.toBeChecked()

    await page.route('**/api/collections/roles/records/**', (route) =>
        route.abort('failed'),
    )

    await checkbox.click()
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect(checkbox).not.toBeChecked()

    await page.unroute('**/api/collections/roles/records/**')
    await reloadSettled(page)
    await expect(checkbox).not.toBeChecked()
})

test('grants and revokes a whole permission group at once', async ({
    adminPage: page,
    root,
    testPrefix,
}) => {
    const role = await createRole(root, `${testPrefix}-role`)
    await gotoSettled(page, '/admin/users#roles')
    await page.getByTestId(`role-permissions-row-${role.name}`).click()

    const groupToggle = page.getByTestId(
        `role-group-toggle-${role.name}-competitions`,
    )
    const manage = page.getByTestId(
        `role-permissions-${role.name}-manage_competitions`,
    )
    const judge = page.getByTestId(
        `role-permissions-${role.name}-judge_competitions`,
    )

    const granted = roleSaved(page)
    await groupToggle.click()
    expect((await granted).ok()).toBe(true)
    await expect(manage).toBeChecked()
    await expect(judge).toBeChecked()

    const revoked = roleSaved(page)
    await groupToggle.click()
    expect((await revoked).ok()).toBe(true)
    await expect(manage).not.toBeChecked()
    await expect(judge).not.toBeChecked()
})
