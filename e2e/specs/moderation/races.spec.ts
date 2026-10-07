import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { mailCount, mailbox, waitForMail } from '../../support/mail'
import { decide, openCase } from '../../support/moderation'

const settle = () => new Promise((resolve) => setTimeout(resolve, 2000))
const toasts = (page: import('@playwright/test').Page) =>
    page.getByTestId('global-snackbar-message')

test('two moderators hiding the same case at once decide it only once', async ({
    adminPage,
    setterPage,
    root,
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
    const reportId = await createReport(adminPage, {
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

    expect((await root.collection('reports').getOne(reportId)).status).toBe(
        'actioned',
    )
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
    await createReport(adminPage, {
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
    const res = await adminPage.request.post(
        '/api/collections/reports/records',
        {
            data: {
                content_type: 'rating',
                content_id: id,
                content_url: '/',
                reason: 'spam_fraud',
                explanation: `${testPrefix}-late`,
                notifier_name: 'Late',
                notifier_email: late,
                good_faith: true,
            },
        },
    )
    // The review is gone, so the report has nothing to point at any more.
    expect(res.status()).toBe(400)
})

test('a report on a profile that is already hidden is answered at once', async ({
    platformPage,
    root,
    createUser,
    testPrefix,
}) => {
    const person = await createUser('user', 'hidden-profile')
    await root
        .collection('users')
        .update(person.id, { firstname: `${testPrefix}-Gone` })
    await openCase(platformPage, `${testPrefix}-Gone`, '/platform/moderation')
    await decide(platformPage, 'hide', 'Offensive name.')

    const late = mailbox(testPrefix, 'late-profile')
    const res = await platformPage.request.post(
        '/api/collections/reports/records',
        {
            data: {
                content_type: 'profile',
                content_id: person.id,
                content_url: '/',
                reason: 'harassment',
                explanation: `${testPrefix}-late-profile`,
                notifier_name: 'Late',
                notifier_email: late,
                good_faith: true,
            },
        },
    )
    expect(res.ok()).toBe(true)
    const decision = await waitForMail(platformPage, late, {
        subject: /decision/i,
    })
    expect(`${decision.HTML}${decision.Text}`).toContain('Offensive name.')
})

test('a profile edited after being hidden comes back for review', async ({
    platformPage,
    root,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const person = await createUser('user', 'renamer')
    await root
        .collection('users')
        .update(person.id, { firstname: `${testPrefix}-Rude` })
    await openCase(platformPage, `${testPrefix}-Rude`, '/platform/moderation')
    await decide(platformPage, 'hide', 'Offensive name.')

    const personPage = await pageAs(person)
    const res = await personPage.request.patch(
        `/api/collections/users/records/${person.id}`,
        {
            headers: await authHeader(personPage),
            data: { firstname: `${testPrefix}-Again` },
        },
    )
    expect(res.ok()).toBe(true)

    await openCase(platformPage, `${testPrefix}-Again`, '/platform/moderation')
})

test('undo after someone else restored the post explains instead of failing', async ({
    adminPage,
    setterPage,
    root,
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
    const item = await root
        .collection('moderation_items')
        .getFirstListItem(root.filter('snapshot ~ {:text}', { text }))
    const restored = await setterPage.request.post(
        `/api/moderation/${item.id}`,
        {
            headers: await authHeader(setterPage),
            data: { action: 'restore', reason: '' },
        },
    )
    expect(restored.ok()).toBe(true)

    await adminPage.getByTestId('global-snackbar-action').first().click()
    await expect(toasts(adminPage).last()).toContainText(/decided elsewhere/i)
})
