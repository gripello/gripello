import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { mailCount, mailbox, waitForMail } from '../../support/mail'
import { decide, openCase } from '../../support/moderation'
import {
    decideModerationCase,
    fileReport,
    findReport,
    guestApi,
    listModerationCases,
    updateMe,
} from '../../support/api'

const settle = () => new Promise((resolve) => setTimeout(resolve, 2000))
const toasts = (page: import('@playwright/test').Page) =>
    page.getByTestId('global-snackbar-message')

test('two moderators hiding the same case at once decide it only once', async ({
    adminPage,
    setterPage,
    api,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await createUser('user', 'author')
    const authorPage = await pageAs(author)
    await gotoSettled(authorPage, gymPath('/'))
    const text = `${testPrefix}-contested`
    const id = await createComment(authorPage, route.id, text)
    const notifier = mailbox(testPrefix, 'notifier')
    const reportId = await createReport({
        contentId: id,
        explanation: `${testPrefix}-r`,
        notifierEmail: notifier,
    })
    await waitForMail(adminPage, notifier, { subject: /received/i })

    for (const page of [adminPage, setterPage]) {
        await openCase(page, text)
        await page.locator('[data-testid="moderation-hide"]:visible').click()
        await page.getByTestId('moderation-reason').fill('Rude.')
    }
    await Promise.all(
        [adminPage, setterPage].map((page) =>
            page.getByTestId('moderation-decision-confirm').click(),
        ),
    )

    const messages = async () =>
        [
            ...(await toasts(adminPage).allInnerTexts()),
            ...(await toasts(setterPage).allInnerTexts()),
        ].join(' | ')
    await expect.poll(messages).toMatch(/Hidden/)
    await expect.poll(messages).toMatch(/decided elsewhere/i)

    expect((await findReport(api, reportId))?.status).toBe('actioned')
    await waitForMail(adminPage, notifier, { subject: /decision/i })
    await waitForMail(adminPage, author.email, { subject: /hidden/i })
    await settle()
    expect(await mailCount(adminPage, notifier)).toBe(2)
    expect(await mailCount(adminPage, author.email)).toBe(1)
})

test('a double click on “Keep visible” decides once', async ({
    adminPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-double`
    const id = await createComment(author, route.id, text)
    const notifier = mailbox(testPrefix, 'double')
    await createReport({
        contentId: id,
        explanation: `${testPrefix}-r`,
        notifierEmail: notifier,
    })

    await openCase(adminPage, text)
    await adminPage
        .locator('[data-testid="moderation-approve"]:visible')
        .dblclick()

    await waitForMail(adminPage, notifier, { subject: /decision/i })
    await settle()
    expect(await mailCount(adminPage, notifier)).toBe(2)
    await expect(
        toasts(adminPage).filter({ hasText: /went wrong|error/i }),
    ).toHaveCount(0)
})

test('a second moderator sees a case leave the moment it is decided', async ({
    adminPage,
    setterPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-live`
    await createComment(author, route.id, text)

    await openCase(setterPage, text)
    const stale = setterPage.locator(
        'article[data-testid^="moderation-detail-"]:visible',
    )
    await openCase(adminPage, text)
    await decide(adminPage, 'approve')

    // Without a reload the decided case leaves the list and the open detail.
    await expect(
        setterPage.getByTestId('moderation-list').getByText(text),
    ).toHaveCount(0, { timeout: 15_000 })
    await expect(stale).toHaveCount(0)
})

test('reporting a review that is already hidden is refused', async ({
    adminPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-late`
    const id = await createComment(author, route.id, text)
    await openCase(adminPage, text)
    await decide(adminPage, 'hide', 'Spam.')

    const late = mailbox(testPrefix, 'late')
    // The review is gone, so the report has nothing to point at any more.
    await expect(
        fileReport(guestApi(), {
            contentType: 'rating',
            contentId: id,
            explanation: `${testPrefix}-late`,
            notifierName: 'Late',
            notifierEmail: late,
        }),
    ).rejects.toMatchObject({ status: 400 })
})

test('a report on a profile that is already hidden is answered at once', async ({
    platformPage,
    apiAs,
    createUser,
    testPrefix,
}) => {
    const person = await createUser('user', 'hidden-profile')
    await updateMe(await apiAs(person), { firstname: `${testPrefix}-Gone` })
    await openCase(platformPage, `${testPrefix}-Gone`, '/platform/moderation')
    await decide(platformPage, 'hide', 'Offensive name.')

    const late = mailbox(testPrefix, 'late-profile')
    await fileReport(guestApi(), {
        contentType: 'profile',
        contentId: person.id,
        reason: 'harassment',
        explanation: `${testPrefix}-late-profile`,
        notifierName: 'Late',
        notifierEmail: late,
    })
    const decision = await waitForMail(platformPage, late, {
        subject: /decision/i,
    })
    expect(`${decision.HTML}${decision.Text}`).toContain('Offensive name.')
})

test('a profile edited after being hidden comes back for review', async ({
    platformPage,
    apiAs,
    createUser,
    testPrefix,
}) => {
    const person = await createUser('user', 'renamer')
    const personApi = await apiAs(person)
    await updateMe(personApi, { firstname: `${testPrefix}-Rude` })
    await openCase(platformPage, `${testPrefix}-Rude`, '/platform/moderation')
    await decide(platformPage, 'hide', 'Offensive name.')

    await updateMe(personApi, { firstname: `${testPrefix}-Again` })

    await openCase(platformPage, `${testPrefix}-Again`, '/platform/moderation')
})

test('undo after someone else restored the post explains instead of failing', async ({
    adminPage,
    setterPage,
    api,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-undo-race`
    await createComment(author, route.id, text)

    await openCase(adminPage, text)
    await decide(adminPage, 'hide', 'Mistake.')
    const [item] = await listModerationCases(api, { q: text })
    await decideModerationCase(await apiOf(setterPage), item!.id, 'restore')

    await adminPage.getByTestId('global-snackbar-action').first().click()
    await expect(toasts(adminPage).last()).toContainText(/decided elsewhere/i)
})
