import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { decide, openCase } from '../../support/moderation'

test('the platform hides a reported review and only the platform restores it', async ({
    platformPage,
    adminPage,
    userPage,
    route,
    testPrefix,
}) => {
    await gotoSettled(userPage, gymPath('/'))
    const text = `${testPrefix}-spam`
    const commentId = await createComment(userPage, route.id, text)
    await createReport(userPage, { contentId: commentId, explanation: text })

    await openCase(platformPage, text, '/platform/moderation')
    await decide(platformPage, 'hide', 'Spam')
    await expect(
        platformPage.getByTestId('global-snackbar-action').first(),
    ).toBeVisible()

    const gone = await userPage.request.get(
        `/api/collections/ratings/records/${commentId}`,
    )
    expect(gone.status()).toBe(404)

    await gotoSettled(adminPage, `/manage/moderation?search=${text}`)
    await adminPage.getByTestId('moderation-view-hidden').click()
    const hidden = adminPage
        .getByTestId('moderation-list')
        .getByRole('button', { name: new RegExp(text) })
    await hidden.click()
    await expect(
        adminPage.locator('article[data-testid^="moderation-detail-"]:visible'),
    ).toContainText('Hidden by Gripello')
    await expect(
        adminPage.locator('[data-testid="moderation-restore"]:visible'),
    ).toHaveCount(0)

    await gotoSettled(platformPage, `/platform/moderation?search=${text}`)
    await platformPage.getByTestId('moderation-view-hidden').click()
    await platformPage
        .getByTestId('moderation-list')
        .getByRole('button', { name: new RegExp(text) })
        .click()
    await decide(platformPage, 'restore')
    await expect
        .poll(async () =>
            (
                await userPage.request.get(
                    `/api/collections/ratings/records/${commentId}`,
                )
            ).status(),
        )
        .toBe(200)
})

test('the staff badge counts open cases', async ({
    adminPage,
    userPage,
    route,
    testPrefix,
}) => {
    await gotoSettled(userPage, gymPath('/'))
    await createComment(userPage, route.id, `${testPrefix}-counted`)
    await gotoSettled(adminPage, '/manage/moderation')
    const sidebar = adminPage
        .getByTestId('nav-link-manage-moderation')
        .locator('xpath=ancestor::a')
    const phone = adminPage.getByTestId('bottom-nav-manage-moderation-count')
    await expect(
        sidebar.or(phone).filter({ visible: true }).first(),
    ).toContainText(/\d+/)
})
