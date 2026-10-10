import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath, reloadSettled } from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { decide, openCase } from '../../support/moderation'
import {
    decideModerationCase,
    findReport,
    listModerationCases,
    type Api,
} from '../../support/api'

async function caseFor(api: Api, text: string) {
    const [item] = await listModerationCases(api, { q: text })
    if (!item) throw new Error(`no moderation case for ${text}`)
    return item
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
    api,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-blank`
    await createComment(author, route.id, text)
    const item = await caseFor(api, text)

    await expect(
        decideModerationCase(await apiOf(adminPage), item.id, 'hide', '   '),
    ).rejects.toMatchObject({ status: 400 })
    expect((await caseFor(api, text)).state).toBe('unreviewed')
})

test('cancelling a decision leaves the case untouched', async ({
    adminPage,
    api,
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
    expect((await caseFor(api, text)).state).toBe('unreviewed')
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
    api,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-once`
    const id = await createComment(author, route.id, text)
    const reportId = await createReport({
        contentId: id,
        explanation: `${testPrefix}-r`,
    })

    await gotoSettled(adminPage, '/manage/routes')
    await openCase(adminPage, text)
    await decide(adminPage, 'approve')
    await expect
        .poll(async () => (await findReport(api, reportId))?.status)
        .toBe('rejected')
    const decidedAt = (await findReport(api, reportId))?.decided_at

    await adminPage.goBack()
    await reloadSettled(adminPage)
    await adminPage.goForward()
    await reloadSettled(adminPage)
    expect((await findReport(api, reportId))?.decided_at).toBe(decidedAt)
    expect((await caseFor(api, text)).state).toBe('approved')
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
