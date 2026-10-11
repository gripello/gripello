import { createRole, e2eGymId, setRolePermissions } from '../../support/api'
import { test, expect } from '../../support/fixtures'
import { signInAs } from '../../support/auth'
import { gotoSubscribed, gymPath } from '../../support/nav'
import { ensureUser } from '../../support/seed'

test('a permission added to the own role shows up without a reload', async ({
    page,
    adminApi,
    testPrefix,
}) => {
    const role = await createRole(adminApi, `${testPrefix}-live`)
    const user = await ensureUser(null, role.id, 'user', testPrefix)
    await signInAs(page, user.email, user.password)
    await gotoSubscribed(page, gymPath('/routes'), `gym:${await e2eGymId()}`)
    await expect(page.getByTestId('nav-staff-tools')).toHaveCount(0)

    await setRolePermissions(adminApi, role.id, ['manage_comments'])

    await expect(page.getByTestId('nav-staff-tools')).toBeVisible()
})
