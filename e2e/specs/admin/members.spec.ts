import type PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { e2eGymId } from '../../support/seed'

async function roleOf(root: PocketBase, user: string) {
    const membership = await root
        .collection('memberships')
        .getFirstListItem(
            root.filter('user = {:user} && gym = {:gym}', {
                user,
                gym: await e2eGymId(root),
            }),
            { expand: 'role', requestKey: null },
        )
        .catch(() => null)
    return membership?.expand?.role?.name ?? null
}

test('changes a member role and removes them again', async ({
    adminPage: page,
    root,
    createUser,
}) => {
    const climber = await createUser('user', 'joiner')
    const gym = await e2eGymId(root)
    const setterRole = await root
        .collection('roles')
        .getFirstListItem(
            root.filter('gym = {:gym} && name = "routesetter"', { gym }),
            { requestKey: null },
        )
    await root
        .collection('memberships')
        .create({ user: climber.id, gym, role: setterRole.id })
    await gotoSettled(page, '/admin/users')

    const card = page
        .locator('tr, li')
        .filter({ has: page.getByTestId(`member-card-${climber.id}`) })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('member-card-role')).toHaveText('routesetter')

    await card.getByTestId('member-card-role').click()
    await page.getByRole('option', { name: 'admin', exact: true }).click()
    await expect.poll(() => roleOf(root, climber.id)).toBe('admin')

    await card.getByTestId('member-card-remove').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(card).toHaveCount(0)
    await expect.poll(() => roleOf(root, climber.id)).toBeNull()
})

test('inviting an account only leaves a pending invite that can be revoked', async ({
    adminPage: page,
    root,
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
    expect(await roleOf(root, climber.id)).toBeNull()

    await pending.getByTestId('pending-invite-revoke').click()
    await expect(pending).toHaveCount(0)
    await expect
        .poll(
            async () =>
                (
                    await root.collection('invites').getFullList({
                        filter: root.filter('email = {:email}', {
                            email: climber.email,
                        }),
                        requestKey: null,
                    })
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
