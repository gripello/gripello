import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { decide, openCase } from '../../support/moderation'

test('a reported profile reaches the platform inbox', async ({
    platformPage,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const reported = await createUser('user', 'rude-profile')
    const reporter = await pageAs(await createUser('user', 'reporter'))

    await gotoSettled(reporter, `/climber?id=${reported.id}`)
    await reporter.getByTestId('climber-menu').click()
    await reporter.getByRole('menuitem', { name: /Report profile/ }).click()
    await reporter.getByTestId('report-form-reason').click()
    await reporter.getByRole('option').first().click()
    await reporter
        .getByTestId('report-form-explanation')
        .first()
        .fill(`${testPrefix} offensive name`)
    await reporter.getByTestId('report-form-name').first().fill('E2E Reporter')
    await reporter
        .getByTestId('report-form-email')
        .first()
        .fill('e2e-reporter@example.com')
    await reporter.getByTestId('report-form-goodfaith').check()
    await reporter.getByTestId('report-form-submit').click()
    await expect(reporter.getByTestId('report-form-dialog')).toBeHidden()

    const username = reported.email.split('@')[0]!.replace('-user', 'user')
    const detail = await openCase(
        platformPage,
        username,
        '/platform/moderation',
    )
    await expect(detail).toContainText(`${testPrefix} offensive name`)
})

test('undo brings a hidden review straight back', async ({
    adminPage,
    route,
    testPrefix,
}) => {
    await gotoSettled(adminPage, gymPath('/'))
    const text = `${testPrefix}-undo-me`
    const commentId = await createComment(adminPage, route.id, text)

    await openCase(adminPage, text)
    await decide(adminPage, 'hide', 'Mistake.')
    await adminPage.getByTestId('global-snackbar-action').first().click()

    await expect
        .poll(async () =>
            (
                await adminPage.request.get(
                    `/api/collections/ratings/records/${commentId}`,
                )
            ).status(),
        )
        .toBe(200)
})
