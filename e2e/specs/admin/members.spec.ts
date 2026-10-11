import {
    addMembership,
    findRole,
    listInvites,
    membershipOf,
    type Api,
} from '../../support/api'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

async function roleOf(api: Api, user: string) {
    return (await membershipOf(api, user))?.role.name ?? null
}

test('changes a member role and removes them again', async ({
    adminPage: page,
    api,
    adminApi,
    createUser,
}) => {
    const climber = await createUser('user', 'joiner')
    const setterRole = await findRole(adminApi, 'routesetter')
    await addMembership(api, climber.id, setterRole.id)
    await gotoSettled(page, '/admin/users')

    const card = page
        .locator('tr, li')
        .filter({ has: page.getByTestId(`member-card-${climber.id}`) })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('member-card-role')).toHaveText('routesetter')

    await card.getByTestId('member-card-role').click()
    await page.getByRole('option', { name: 'admin', exact: true }).click()
    await expect.poll(() => roleOf(adminApi, climber.id)).toBe('admin')

    await card.getByTestId('member-card-remove').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(card).toHaveCount(0)
    await expect.poll(() => roleOf(adminApi, climber.id)).toBeNull()
})

test('inviting an account only leaves a pending invite that can be revoked', async ({
    adminPage: page,
    adminApi,
    createUser,
}) => {
    const climber = await createUser('user', 'pending')
    await gotoSettled(page, '/admin/users')

    await page.getByTestId('member-invite-open').click()
    await page.getByTestId('member-invite-email').fill(climber.email)
    await page.getByTestId('member-invite-role').click()
    await page.getByRole('option', { name: 'routesetter', exact: true }).click()
    await page.getByTestId('member-invite-submit').click()
    await expect(page.getByTestId('member-invite-dialog')).toBeHidden()

    const pending = page.getByTestId(`pending-invite-${climber.email}`)
    await expect(pending).toBeVisible()
    await expect(page.getByTestId(`member-card-${climber.id}`)).toHaveCount(0)
    expect(await roleOf(adminApi, climber.id)).toBeNull()

    await pending.getByTestId('pending-invite-revoke').click()
    await expect(pending).toHaveCount(0)
    await expect
        .poll(
            async () =>
                (await listInvites(adminApi)).filter(
                    (invite) => invite.email === climber.email,
                ).length,
        )
        .toBe(0)
})

test('climbers do not show up in the member list', async ({
    adminPage: page,
    createUser,
}) => {
    const climber = await createUser('user', 'outsider')
    await gotoSettled(page, '/admin/users')
    await page.getByTestId('filter-search').fill(climber.email)
    await expect(page.getByTestId('empty-state')).toBeVisible()
    await expect(page.getByTestId(`member-card-${climber.id}`)).toHaveCount(0)
})
