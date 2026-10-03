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

test('adds a climber by email, changes the role and removes them again', async ({
    adminPage: page,
    root,
    createUser,
}) => {
    const climber = await createUser('user', 'joiner')
    await gotoSettled(page, '/admin/users')

    await page.getByTestId('member-invite-open').click()
    await expect(page.getByTestId('member-invite-dialog')).toBeVisible()
    await page.getByTestId('member-invite-email').fill(climber.email)
    await page.getByTestId('member-invite-role').click()
    await page.getByRole('option', { name: 'routesetter', exact: true }).click()
    await page.getByTestId('member-invite-submit').click()
    await expect(page.getByTestId('member-invite-dialog')).toBeHidden()

    const card = page.getByTestId(`member-card-${climber.id}`)
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
