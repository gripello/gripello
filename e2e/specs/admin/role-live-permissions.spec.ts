import { test, expect } from '../../support/fixtures'
import { signInAs } from '../../support/auth'
import { gotoSettled, gymPath } from '../../support/nav'
import { e2eGymId, ensureUser } from '../../support/seed'

test('a permission added to the own role shows up without a reload', async ({
    page,
    root,
    testPrefix,
}) => {
    const role = await root.collection('roles').create({
        gym: await e2eGymId(root),
        name: `${testPrefix}-live`,
        permissions: [],
    })
    const user = await ensureUser(root, role.id, 'user', testPrefix)
    try {
        await signInAs(page, user.email, user.password)
        await gotoSettled(page, gymPath('/routes'))
        await expect(page.getByTestId('nav-group-moderation')).toHaveCount(0)

        const manageComments = await root
            .collection('permissions')
            .getFirstListItem('name = "manage_comments"')
        await root
            .collection('roles')
            .update(role.id, { permissions: [manageComments.id] })

        await expect(page.getByTestId('nav-group-moderation')).toBeVisible()
    } finally {
        await root.collection('users').delete(user.id)
        await root.collection('roles').delete(role.id)
    }
})
