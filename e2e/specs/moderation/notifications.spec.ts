import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { reportAs } from '../../support/reports'
import { openFromBell, waitForNotification } from '../../support/notifications'
import { createModerationGym, decide, openCase } from '../../support/moderation'
import {
    apiAs,
    createBetaLink,
    deleteGym,
    notificationsOfType,
    updateGym,
    waitForNotificationOfType,
} from '../../support/api'

const seededSetter = () =>
    apiAs({
        email: 'e2e-routesetter@gripello.test',
        password: 'E2ePassw0rd!',
    })

const mentions = (text: string) => (item: { params?: unknown }) =>
    JSON.stringify(item.params ?? {}).includes(text)

test('a report alerts the gym’s report handlers and leads to the inbox', async ({
    adminPage,
    userPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-alert`
    const id = await createComment(author, route.id, text)
    await reportAs(userPage, {
        contentType: 'rating',
        contentId: id,
        explanation: `${testPrefix}-x`,
    })

    const notice = await waitForNotification(adminPage, text)
    expect(notice.type).toBe('report_filed')
    expect(
        (
            await notificationsOfType(await seededSetter(), 'report_filed')
        ).filter(mentions(text)),
    ).toHaveLength(0)

    await gotoSettled(adminPage, gymPath('/manage/routes'))
    await openFromBell(adminPage, notice.id)
    await adminPage.waitForURL(/\/e2e\/manage\/moderation/)
})

test('legal reports reach the platform, “something else” stays with the gym', async ({
    adminPage,
    platformPage,
    userPage,
    api,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const legal = await createComment(author, route.id, `${testPrefix}-legal`)
    const other = await createComment(author, route.id, `${testPrefix}-other`)
    await reportAs(userPage, {
        contentType: 'rating',
        contentId: legal,
        reason: 'hate_speech',
        explanation: `${testPrefix}-h`,
    })
    await reportAs(userPage, {
        contentType: 'rating',
        contentId: other,
        reason: 'other',
        explanation: `${testPrefix}-o`,
    })

    const escalation = await waitForNotification(
        platformPage,
        `${testPrefix}-legal`,
    )
    expect(escalation.type).toBe('report_filed_platform')
    await waitForNotification(adminPage, `${testPrefix}-other`)
    expect(
        (await notificationsOfType(api, 'report_filed_platform')).filter(
            mentions(`${testPrefix}-other`),
        ),
    ).toHaveLength(0)

    await gotoSettled(platformPage, '/platform')
    await openFromBell(platformPage, escalation.id)
    await platformPage.waitForURL(/\/platform\/moderation/)
})

test('waiting uploads alert their gym and the decision reaches the uploader', async ({
    api,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const gym = await createModerationGym(testPrefix)
    try {
        await updateGym(api, gym.id, { premoderate_betas: true })
        const setter = await seededSetter()
        const before = (await notificationsOfType(setter, 'moderation_pending'))
            .length
        const uploaderUser = await createUser('user', 'uploader')
        const uploader = await pageAs(uploaderUser)
        const uploaderApi = await apiOf(uploader)
        for (const suffix of ['yes', 'no']) {
            expect(
                await createBetaLink(
                    uploaderApi,
                    gym.routeId,
                    `https://youtube.com/shorts/${testPrefix}-${suffix}`,
                ),
            ).toMatchObject({ pending: true })
        }

        const staffNotice = await waitForNotificationOfType(
            await apiAs(gym.staff),
            'moderation_pending',
        )
        expect(staffNotice.url).toBe(`/${gym.slug}/manage/moderation`)
        expect(
            (await notificationsOfType(setter, 'moderation_pending')).length,
        ).toBe(before)

        const staff = await pageAs(gym.staff)
        const inbox = `/${gym.slug}/manage/moderation`
        await openCase(staff, `${testPrefix}-yes`, inbox, 'approval')
        await decide(staff, 'approve')
        await openCase(staff, `${testPrefix}-no`, inbox, 'approval')
        await decide(staff, 'reject', 'Wrong route.')

        const approved = await waitForNotificationOfType(
            uploaderApi,
            'beta_approved',
        )
        expect(approved.url).toMatch(
            new RegExp(`^/route\\?id=${gym.routeId}#beta-`),
        )
        const rejected = await waitForNotificationOfType(
            uploaderApi,
            'beta_rejected',
        )
        expect(JSON.stringify(rejected.params)).toContain('Wrong route.')

        await gotoSettled(uploader, '/logbook')
        await openFromBell(uploader, approved.id)
        await uploader.waitForURL(new RegExp(`/route\\?id=${gym.routeId}`))
    } finally {
        await deleteGym(api, gym.id)
    }
})

test('a hidden post notifies only its author', async ({
    adminPage,
    apiAs,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const authorUser = await createUser('user', 'author')
    const bystander = await createUser('user', 'bystander')
    const author = await pageAs(authorUser)
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-hide-me`
    await createComment(author, route.id, text)

    await openCase(adminPage, text)
    await decide(adminPage, 'hide', `${testPrefix}-because`)

    const notice = await waitForNotificationOfType(
        await apiAs(authorUser),
        'content_hidden',
    )
    expect(JSON.stringify(notice.params)).toContain(`${testPrefix}-because`)
    expect(
        await notificationsOfType(await apiAs(bystander), 'content_hidden'),
    ).toHaveLength(0)
})
