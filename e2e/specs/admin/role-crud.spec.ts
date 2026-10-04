import { test, expect } from '../../support/fixtures'
import { gotoSettled, reloadSettled } from '../../support/nav'
import { e2eRole } from '../../support/seed'

test('creates a role with a color, toggles a permission, then deletes it', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, '/admin/users#roles')
    await expect(page.getByTestId('role-list')).toBeVisible()

    const name = `${testPrefix}-role`

    await page.getByTestId('role-create-open').click()
    await expect(page.getByTestId('role-form-dialog')).toBeVisible()
    await page.getByTestId('role-form-name').fill(name)
    await page.getByTestId('role-form-description').fill('created by e2e')
    await page.getByTestId('role-form-swatch-42A5F5').click()
    await page.getByTestId('role-form-submit').click()
    await expect(page.getByTestId('role-form-dialog')).toBeHidden()

    await expect(page.getByTestId(`role-permissions-row-${name}`)).toBeVisible()
    await expect(page.getByTestId('role-detail')).toContainText(name)
    await expect(page.getByTestId('role-detail')).toContainText(
        'created by e2e',
    )

    await expect(page.getByTestId(`role-color-${name}`)).toHaveCSS(
        'background-color',
        'rgb(66, 165, 245)',
    )

    const toggle = page.getByTestId(`role-permissions-${name}-view_analytics`)
    await expect(toggle).not.toBeChecked()
    const saved = page.waitForResponse(
        (res) =>
            res.request().method() === 'PATCH' &&
            res.url().includes('/api/collections/roles/records/'),
    )
    await toggle.click()
    expect((await saved).ok()).toBe(true)
    await expect(toggle).toBeChecked()
    await expect(page.getByTestId(`role-granted-${name}`)).toHaveText(/^1\//)

    await reloadSettled(page)
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
    await gotoSettled(page, '/admin/users#roles')

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
    const reassign = page.getByTestId('role-delete-reassign')
    // other workers' role changes re-render the open listbox and can swallow the pick
    await expect(async () => {
        await reassign.click()
        await page
            .getByRole('option', { name: 'routesetter', exact: true })
            .click()
        await expect(reassign).toHaveText('routesetter', { timeout: 1000 })
    }).toPass()
    await page.getByTestId('role-delete-confirm').click()
    await expect(page.getByTestId('role-delete-dialog')).toBeHidden()

    await expect(
        page.getByTestId(`role-permissions-row-${roleName}`),
    ).toBeHidden()

    await page.getByRole('tab', { name: 'Members' }).click()
    await page.getByTestId('filter-search').fill(holder.email)
    const card = page
        .locator('tr, li')
        .filter({ has: page.getByTestId(`member-card-${holder.id}`) })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('member-card-role')).toHaveText('routesetter')
})

test('the admin role cannot be deleted and its permissions are locked', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/users#roles')

    await page.getByTestId('role-permissions-row-admin').click()
    await expect(page.getByTestId('role-detail')).toContainText('admin')
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
    await gotoSettled(page, '/admin/users#roles')

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

    await expect(page.getByTestId('member-invite-open')).toBeVisible()
    const userButton = await style('member-invite-open')
    await page.getByRole('tab', { name: 'Roles & permissions' }).click()
    await expect(page.getByTestId('role-create-open')).toBeVisible()
    await expect.poll(() => style('role-create-open')).toEqual(userButton)
})

test('duplicates a role with its colour and permissions', async ({
    adminPage: page,
    root,
    testPrefix,
}) => {
    await gotoSettled(page, '/admin/users#roles')

    const name = `${testPrefix}-source`
    await page.getByTestId('role-create-open').click()
    await page.getByTestId('role-form-name').fill(name)
    await page.getByTestId('role-form-swatch-26A69A').click()
    await page.getByTestId('role-form-submit').click()
    await expect(page.getByTestId('role-form-dialog')).toBeHidden()
    await expect(page.getByTestId(`role-members-${name}`)).toHaveText('0')

    const toggle = page.getByTestId(`role-permissions-${name}-view_analytics`)
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(page.getByTestId(`role-granted-${name}`)).toHaveText(/^1\//)

    await page.getByTestId(`role-duplicate-${name}`).click()
    await expect(page.getByTestId('role-form-name')).toHaveValue(
        `${name} (copy)`,
    )
    await page.getByTestId('role-form-submit').click()
    await expect(page.getByTestId('role-form-dialog')).toBeHidden()

    const copy = `${name} (copy)`
    await expect(page.getByTestId('role-detail')).toContainText(copy)
    await expect(
        page.getByTestId(`role-permissions-${copy}-view_analytics`),
    ).toBeChecked()
    await expect(page.getByTestId(`role-color-${copy}`)).toHaveCSS(
        'background-color',
        'rgb(38, 166, 154)',
    )

    const source = await e2eRole(root, name)
    const duplicate = await e2eRole(root, copy)
    expect(duplicate.permissions).toEqual(source.permissions)

    for (const role of [duplicate, source])
        await root.collection('roles').delete(role.id)
})
