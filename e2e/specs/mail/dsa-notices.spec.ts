import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { waitForMail, mailCount, mailbox } from '../../support/mail'
import { decide, openCase } from '../../support/moderation'

test('Art. 16(4): the notifier gets a receipt and moderators get an alert', async ({
    adminPage: page,
    route,
    testPrefix,
}) => {
    const notifier = mailbox(testPrefix, 'notifier')

    await gotoSettled(page, '/manage/moderation')
    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-receipt`,
    )
    const reportId = await createReport(page, {
        contentId: commentId,
        explanation: `${testPrefix}-receipt-explanation`,
        notifierEmail: notifier,
    })

    const receipt = await waitForMail(page, notifier, { subject: /received/i })
    expect(receipt.HTML).not.toContain(`${testPrefix}-receipt-explanation`)
    expect(receipt.HTML).toContain(reportId)

    const alert = await waitForMail(page, 'e2e-admin@gripello.test', {
        subject: /new content report/i,
        bodyIncludes: `${testPrefix}-receipt-explanation`,
    })
    expect(alert.HTML).toContain('/manage/moderation')
})

test('Art. 16(5): the notifier is told the decision, exactly once', async ({
    adminPage: page,
    route,
    testPrefix,
}) => {
    const notifier = mailbox(testPrefix, 'decision')

    await gotoSettled(page, '/manage/moderation')
    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-decide`,
    )
    await createReport(page, {
        contentId: commentId,
        explanation: `${testPrefix}-decide-explanation`,
        notifierEmail: notifier,
    })

    await waitForMail(page, notifier, { subject: /received/i })

    await openCase(page, `${testPrefix}-decide`)
    await decide(page, 'hide', `${testPrefix}-reasoning`)

    const decision = await waitForMail(page, notifier, {
        subject: /decision/i,
    })
    expect(decision.HTML).toContain(`${testPrefix}-reasoning`)
    expect(decision.HTML).toMatch(/out-of-court|dispute settlement/i)

    expect(await mailCount(page, notifier)).toBe(2)
})
