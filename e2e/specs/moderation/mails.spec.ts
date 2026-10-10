import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import { suspendUser, updateMe } from '../../support/api'
import { createComment } from '../../support/comments'
import { createReport, reportAs } from '../../support/reports'
import { mailCount, mailbox, waitForMail } from '../../support/mail'
import { decide, openCase } from '../../support/moderation'

const settle = () => new Promise((resolve) => setTimeout(resolve, 2000))

test('hiding a review sends its author one statement of reasons', async ({
    adminPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await createUser('user', 'author')
    const authorPage = await pageAs(author)
    await gotoSettled(authorPage, gymPath('/'))
    const text = `${testPrefix}-statement`
    await createComment(authorPage, route.id, text)

    await openCase(adminPage, text)
    await decide(adminPage, 'hide', `${testPrefix}-reason`)

    const mail = await waitForMail(adminPage, author.email, {
        subject: /has been hidden/i,
        bodyIncludes: `${testPrefix}-reason`,
    })
    expect(`${mail.HTML}${mail.Text}`).toContain('Review')
    expect(`${mail.HTML}${mail.Text}`).toMatch(/out-of-court|dispute/i)
    await settle()
    expect(await mailCount(adminPage, author.email)).toBe(1)
})

test('hiding everything of one person sends a single statement', async ({
    platformPage,
    userPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const spammer = await createUser('user', 'spammer')
    const spamPage = await pageAs(spammer)
    await gotoSettled(spamPage, gymPath('/'))
    const first = await createComment(spamPage, route.id, `${testPrefix}-ad-1`)
    await createComment(spamPage, route.id, `${testPrefix}-ad-2`)
    await createComment(spamPage, route.id, `${testPrefix}-ad-3`)
    await reportAs(userPage, {
        contentType: 'rating',
        contentId: first,
        explanation: `${testPrefix}-ads`,
    })

    await openCase(platformPage, `${testPrefix}-ad-1`, '/platform/moderation')
    await platformPage
        .locator('[data-testid="moderation-author-hide"]:visible')
        .click()
    await platformPage.getByTestId('moderation-reason').fill('Advertising.')
    await platformPage.getByTestId('moderation-decision-confirm').click()

    await waitForMail(platformPage, spammer.email, { subject: /hidden/i })
    await settle()
    expect(await mailCount(platformPage, spammer.email)).toBe(1)
})

test('every reporter gets a receipt and exactly one decision', async ({
    adminPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-twice`
    const id = await createComment(author, route.id, text)
    const first = mailbox(testPrefix, 'first')
    const second = mailbox(testPrefix, 'second')
    for (const to of [first, second]) {
        await createReport({
            contentId: id,
            explanation: `${testPrefix}-by-${to}`,
            notifierEmail: to,
        })
        await waitForMail(adminPage, to, { subject: /received/i })
    }

    await openCase(adminPage, text)
    await decide(adminPage, 'hide', 'Insulting.')

    for (const to of [first, second]) {
        const decision = await waitForMail(adminPage, to, {
            subject: /decision/i,
        })
        expect(`${decision.HTML}${decision.Text}`).toContain('Insulting.')
    }
    await settle()
    expect(await mailCount(adminPage, first)).toBe(2)
    expect(await mailCount(adminPage, second)).toBe(2)
})

test('a lifetime suspension is announced as permanent', async ({
    platformPage,
    createUser,
    testPrefix,
}) => {
    const person = await createUser('user', 'banned')
    await suspendUser(await apiOf(platformPage), person.id, {
        permanent: true,
        reason: `${testPrefix}-why`,
    })

    const mail = await waitForMail(platformPage, person.email, {
        subject: /suspended/i,
        bodyIncludes: `${testPrefix}-why`,
    })
    expect(`${mail.HTML}${mail.Text}`).toContain('Permanently')
})

test('authors get the statement in their own language', async ({
    adminPage,
    apiAs,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await createUser('user', 'german')
    await updateMe(await apiAs(author), { language: 'de' })
    const authorPage = await pageAs(author)
    await gotoSettled(authorPage, gymPath('/'))
    const text = `${testPrefix}-deutsch`
    await createComment(authorPage, route.id, text)

    await openCase(adminPage, text)
    await decide(adminPage, 'hide', 'Beleidigend.')

    await waitForMail(adminPage, author.email, {
        subject: /ausgeblendet/i,
        bodyIncludes: 'Beleidigend.',
    })
})
