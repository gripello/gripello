import {
    deleteUser,
    e2eGymId,
    getPlatformUser,
    setUserFlags,
} from '../../support/api'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('platform admin edits a user, manages memberships and deletes the account', async ({
    platformPage: page,
    api,
    createUser,
}) => {
    const stamp = Date.now()
    const user = await createUser('user', 'pu')
    const email = user.email
    setUserFlags(user.id, { verified: false })
    const gym = { id: await e2eGymId() }
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
                const saved = await getPlatformUser(api, user.id)
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
        await expect(getPlatformUser(api, user.id)).rejects.toMatchObject({
            status: 404,
        })
    } finally {
        try {
            deleteUser(user.id)
        } catch {}
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
