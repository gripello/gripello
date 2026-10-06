import { test, expect } from '../../support/fixtures'
import {
    authHeader,
    gotoSettled,
    gymPath,
    reloadSettled,
} from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { decide, openCase } from '../../support/moderation'

async function caseFor(root: import('pocketbase').default, text: string) {
    return root
        .collection('moderation_items')
        .getFirstListItem(root.filter('snapshot ~ {:text}', { text }))
}

test('hiding needs a real reason', async ({
    adminPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-reasonless`
    await createComment(author, route.id, text)

    await openCase(adminPage, text)
    await adminPage.locator('[data-testid="moderation-hide"]:visible').click()
    const confirm = adminPage.getByTestId('moderation-decision-confirm')
    await expect(confirm).toBeDisabled()
    await adminPage.getByTestId('moderation-reason').fill('    ')
    await expect(confirm).toBeDisabled()
    await adminPage.getByTestId('moderation-reason-spam_fraud').click()
    await expect(confirm).toBeEnabled()
})

test('the server refuses a blank reason even without the dialog', async ({
    adminPage,
    root,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-blank`
    await createComment(author, route.id, text)
    const item = await caseFor(root, text)

    const res = await adminPage.request.post(`/api/moderation/${item.id}`, {
        headers: await authHeader(adminPage),
        data: { action: 'hide', reason: '   ' },
    })
    expect(res.status()).toBe(400)
    expect((await caseFor(root, text)).state).toBe('unreviewed')
})

test('cancelling a decision leaves the case untouched', async ({
    adminPage,
    root,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-cancelled`
    await createComment(author, route.id, text)

    await openCase(adminPage, text)
    await adminPage.locator('[data-testid="moderation-hide"]:visible').click()
    await adminPage.getByTestId('moderation-reason').fill('Changed my mind')
    await adminPage
        .getByTestId('moderation-decision-dialog')
        .getByRole('button', { name: 'Cancel' })
        .click()
    await expect(
        adminPage.getByTestId('moderation-decision-dialog'),
    ).toBeHidden()
    expect((await caseFor(root, text)).state).toBe('unreviewed')
})

test('a broken case link still opens the inbox', async ({ adminPage }) => {
    await gotoSettled(adminPage, '/manage/moderation?case=doesnotexist123')
    await expect(adminPage.getByTestId('moderation-error')).toHaveCount(0)
    await expect(
        adminPage
            .getByTestId('moderation-list')
            .or(adminPage.getByTestId('moderation-empty')),
    ).toBeVisible()
})

test('going back or reloading after a decision does not decide again', async ({
    adminPage,
    root,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-once`
    const id = await createComment(author, route.id, text)
    const reportId = await createReport(adminPage, {
        contentId: id,
        explanation: `${testPrefix}-r`,
    })

    await gotoSettled(adminPage, '/manage/routes')
    await openCase(adminPage, text)
    await decide(adminPage, 'approve')
    await expect
        .poll(
            async () =>
                (await root.collection('reports').getOne(reportId)).status,
        )
        .toBe('rejected')
    const decidedAt = (await root.collection('reports').getOne(reportId))
        .decided_at

    await adminPage.goBack()
    await reloadSettled(adminPage)
    await adminPage.goForward()
    await reloadSettled(adminPage)
    expect((await root.collection('reports').getOne(reportId)).decided_at).toBe(
        decidedAt,
    )
    expect((await caseFor(root, text)).state).toBe('approved')
})

test('a long reason is kept in full', async ({
    adminPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-long-reason`
    await createComment(author, route.id, text)
    const reason =
        `${'Detailed explanation. '.repeat(60)}${testPrefix}-end`.slice(-1500)

    await openCase(adminPage, text)
    await decide(adminPage, 'hide', reason)
    await openCase(adminPage, text, '/manage/moderation', 'hidden')
    await expect(
        adminPage.getByTestId('moderation-decision-note'),
    ).toContainText(`${testPrefix}-end`)
})
