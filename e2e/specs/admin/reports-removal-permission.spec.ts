import { test } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createRole } from '../../support/seed'

test('a role with report rights only does not get the moderation inbox', async ({
    root,
    testPrefix,
    createUser,
    pageAs,
}) => {
    const role = await createRole(root, `${testPrefix}-reports-only`, [
        'manage_reports',
    ])
    const page = await pageAs(await createUser(role.id, 'moderator'))

    await gotoSettled(page, '/manage/moderation')
    await page.waitForURL((url) => !url.pathname.endsWith('/manage/moderation'))
})
