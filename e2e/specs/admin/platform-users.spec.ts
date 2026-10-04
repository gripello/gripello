import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('platform admin edits a user, manages memberships and deletes the account', async ({
    platformPage: page,
    root,
}) => {
    const stamp = Date.now()
    const email = `e2e-pu-${stamp}@gripello.test`
    const user = await root.collection('users').create({
        email,
        username: `e2e_pu_${stamp}`,
        password: 'e2e-password-123',
        passwordConfirm: 'e2e-password-123',
        firstname: 'Paula',
        name: 'User',
        verified: false,
    })
    const gym = await root
        .collection('gyms')
        .getFirstListItem('slug = "e2e"', { requestKey: null })
    try {
        await gotoSettled(page, '/platform/users')
        await page.getByTestId('filter-search').fill(email)
        const row = page.getByTestId(`platform-user-${user.id}`)
        await expect(row).toBeVisible()
        await expect(
            row.getByTestId('platform-user-verified-badge'),
        ).toBeVisible()

        await row.getByTestId('platform-user-edit').click()
        const dialog = page.getByTestId('platform-user-dialog')
        await expect(
            page.getByTestId('platform-user-platform-admin'),
        ).toBeDisabled()
        await page
            .getByTestId('platform-user-username')
            .fill(`e2e_renamed_${stamp}`)
        await page.getByTestId('platform-user-firstname').fill('Renamed')
        await page.getByTestId('platform-user-verified').click()
        await page.getByTestId('platform-user-save').click()
        await expect(dialog).toBeHidden()
        await expect
            .poll(async () => {
                const saved = await root.collection('users').getOne(user.id)
                return [saved.username, saved.firstname, saved.verified]
            })
            .toEqual([`e2e_renamed_${stamp}`, 'Renamed', true])

        await row.getByTestId('platform-user-edit').click()
        await page.getByTestId('platform-user-add-gym').click()
        await page
            .getByRole('option')
            .filter({ hasText: /e2e/i })
            .first()
            .click()
        await page.getByTestId('platform-user-add-membership').click()
        await expect(
            page.getByTestId(`platform-user-membership-${gym.id}`),
        ).toBeVisible()
        await expect(
            row.getByTestId(`platform-user-chip-${gym.id}`),
        ).toBeVisible()

        await page.getByTestId('platform-user-membership-remove').click()
        await expect(
            page.getByTestId(`platform-user-membership-${gym.id}`),
        ).toHaveCount(0)

        await page.getByTestId('platform-user-delete-account').click()
        await page.getByTestId('confirm-dialog-confirm').click()
        await expect(row).toHaveCount(0)
        await expect(
            root.collection('users').getOne(user.id),
        ).rejects.toMatchObject({
            status: 404,
        })
    } finally {
        await root
            .collection('users')
            .delete(user.id)
            .catch(() => {})
    }
})

test('platform admins appear read-only and cannot be deleted', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/platform/users')
    await page.getByTestId('platform-users-filter').click()
    await page.getByRole('option').first().click()
    const rows = page.getByTestId('platform-user-list').locator('li')
    await expect(rows.first()).toBeVisible()
    await expect(
        rows.first().getByTestId('platform-user-admin-badge'),
    ).toBeVisible()
    await expect(
        rows.first().getByTestId('platform-user-delete'),
    ).toBeDisabled()
})
