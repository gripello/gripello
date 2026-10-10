import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { listModerationCases } from '../../support/api'
import { E2E_GYM_SLUG } from '../../support/seed'

test('a moderator decides cases from a phone', async ({
    adminPage,
    adminApi,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    await createComment(author, route.id, `${testPrefix}-keep-phone`)
    await createComment(author, route.id, `${testPrefix}-hide-phone`)

    await gotoSettled(adminPage, '/manage/routes')
    await expect(
        adminPage.getByTestId('bottom-nav-manage-moderation-count'),
    ).toBeVisible()
    await adminPage.getByTestId('bottom-nav-manage-moderation').click()
    await adminPage.waitForURL(/\/manage\/moderation/)

    await adminPage.getByTestId('moderation-search').fill(testPrefix)
    const list = adminPage.getByTestId('moderation-list')
    await list
        .getByRole('button', { name: new RegExp(`${testPrefix}-keep-phone`) })
        .click()
    const sheet = adminPage.getByRole('dialog')
    await expect(sheet).toContainText(`${testPrefix}-keep-phone`)
    await sheet.getByTestId('moderation-approve').click()
    await expect(sheet).toBeHidden()
    await expect(
        adminPage.getByTestId('global-snackbar-message').last(),
    ).toContainText(/kept visible/i)

    await list
        .getByRole('button', { name: new RegExp(`${testPrefix}-hide-phone`) })
        .click()
    await adminPage.getByRole('dialog').getByTestId('moderation-hide').click()
    await adminPage.getByTestId('moderation-reason').fill('Off topic.')
    await adminPage.getByTestId('moderation-decision-confirm').click()
    await expect
        .poll(
            async () =>
                (
                    await listModerationCases(adminApi, {
                        gym: E2E_GYM_SLUG,
                        q: `${testPrefix}-hide-phone`,
                        state: ['hidden'],
                    })
                )[0]?.state,
        )
        .toBe('hidden')
})
