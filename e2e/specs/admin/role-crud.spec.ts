import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { e2eRole } from '../../support/seed'

test('creates a role with a color, toggles a permission, then deletes it', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, '/admin/users')
    await expect(page.getByTestId('role-permissions-table')).toBeVisible()

    const name = `${testPrefix}-role`

    await page.getByTestId('role-create-open').click()
    await expect(page.getByTestId('role-form-dialog')).toBeVisible()
    await page.getByTestId('role-form-name').fill(name)
    await page.getByTestId('role-form-description').fill('created by e2e')
    await page.getByTestId('role-form-swatch-42A5F5').click()
    await page.getByTestId('role-form-submit').click()
    await expect(page.getByTestId('role-form-dialog')).toBeHidden()

    const card = page.getByTestId(`role-permissions-row-${name}`)
    await expect(card).toBeVisible()
    await expect(card).toContainText('created by e2e')

    await expect(page.getByTestId(`role-color-${name}`)).toHaveCSS(
        'background-color',
        'rgb(66, 165, 245)',
    )

    const checkbox = page.getByTestId(`role-permissions-${name}-view_analytics`)
    await expect(checkbox).not.toBeChecked()
    const saved = page.waitForResponse(
        (res) =>
            res.request().method() === 'PATCH' &&
            res.url().includes('/api/collections/roles/records/'),
    )
    await checkbox.click()
    expect((await saved).ok()).toBe(true)
    await expect(checkbox).toBeChecked()

    await gotoSettled(page, '/admin/users')
    await expect(
        page.getByTestId(`role-permissions-${name}-view_analytics`),
    ).toBeChecked()

    await page.getByTestId(`role-delete-${name}`).click()
    await expect(page.getByTestId('role-delete-dialog')).toBeVisible()
    await expect(page.getByTestId('role-delete-reassign')).toBeHidden()
    await page.getByTestId('role-delete-confirm').click()

    await expect(page.getByTestId('role-delete-dialog')).toBeHidden()
    await expect(page.getByTestId(`role-permissions-row-${name}`)).toBeHidden()
})

test('moves the holders of a deleted role to the role picked in the dialog', async ({
    adminPage: page,
    root,
    testPrefix,
    createUser,
}) => {
    await gotoSettled(page, '/admin/users')

    const roleName = `${testPrefix}-doomed`

    await page.getByTestId('role-create-open').click()
    await page.getByTestId('role-form-name').fill(roleName)
    await page.getByTestId('role-form-submit').click()
    await expect(page.getByTestId('role-form-dialog')).toBeHidden()
    await expect(
        page.getByTestId(`role-permissions-row-${roleName}`),
    ).toBeVisible()

    const doomed = await e2eRole(root, roleName)
    const holder = await createUser(doomed.id, 'reassign')

    await page.getByTestId(`role-delete-${roleName}`).click()
    await expect(page.getByTestId('role-delete-dialog')).toBeVisible()
    await expect(page.getByTestId('role-delete-holders')).toBeVisible()
    await page.getByTestId('role-delete-reassign').click()
    await page.getByRole('option', { name: 'routesetter', exact: true }).click()
    await page.getByTestId('role-delete-confirm').click()
    await expect(page.getByTestId('role-delete-dialog')).toBeHidden()

    await expect(
        page.getByTestId(`role-permissions-row-${roleName}`),
    ).toBeHidden()

    await page.getByTestId('filter-search').fill(holder.email)
    const card = page.getByTestId(`member-card-${holder.id}`)
    await expect(card).toBeVisible()
    await expect(card.getByTestId('member-card-role')).toHaveText('routesetter')
})

test('the admin role cannot be deleted and its permissions are locked', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/users')

    const adminCard = page.getByTestId('role-permissions-row-admin')
    await expect(adminCard).toBeVisible()
    await expect(page.getByTestId('role-delete-admin')).toHaveCount(0)
    await expect(
        page.getByTestId('role-permissions-admin-manage_users'),
    ).toBeDisabled()

    await page.getByTestId('role-edit-admin').click()
    await expect(page.getByTestId('role-form-dialog')).toBeVisible()
    await expect(page.getByTestId('role-form-name')).not.toBeEditable()
})

test('rejects a role name that is already taken', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/users')

    await page.getByTestId('role-create-open').click()
    await page.getByTestId('role-form-name').fill('admin')
    await page.getByTestId('role-form-submit').click()

    await expect(page.getByTestId('role-form-dialog')).toBeVisible()
    await expect(
        page.getByTestId('role-form-name'),
    ).toHaveAccessibleDescription(/already/)
})

test('add role button looks like the add member button', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/users')
    const style = (testId: string) =>
        page.getByTestId(testId).evaluate((button) => {
            const computed = getComputedStyle(button)
            return {
                height: button.getBoundingClientRect().height,
                background: computed.backgroundColor,
                color: computed.color,
                fontSize: computed.fontSize,
            }
        })

    await expect(page.getByTestId('role-create-open')).toBeVisible()
    await expect(page.getByTestId('member-invite-open')).toBeVisible()
    const userButton = await style('member-invite-open')
    await expect.poll(() => style('role-create-open')).toEqual(userButton)
})
