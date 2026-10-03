import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { createRole } from '../../support/seed'

test('a moderator without comment rights is not offered removal of a reported comment', async ({
    adminPage,
    root,
    route,
    testPrefix,
    createUser,
    pageAs,
}) => {
    const role = await createRole(root, `${testPrefix}-reports-only`, [
        'manage_reports',
    ])
    const page = await pageAs(await createUser(role.id, 'moderator'))

    await gotoSettled(adminPage, gymPath('/'))
    const commentId = await createComment(
        adminPage,
        route.id,
        `${testPrefix}-keep-me`,
    )
    const reportId = await createReport(adminPage, {
        contentId: commentId,
        explanation: `${testPrefix}-report`,
    })

    await gotoSettled(page, '/manage/reports')
    const card = page.getByTestId(`report-card-${reportId}`)
    await expect(card.getByTestId('report-card-keep')).toBeVisible()
    await expect(card.getByTestId('report-card-remove')).toHaveCount(0)
    await expect(card.getByTestId('report-card-status')).toContainText(/open/i)
    const comment = await adminPage.request.get(
        `/api/collections/ratings/records/${commentId}`,
    )
    expect(comment.status()).toBe(200)
})
