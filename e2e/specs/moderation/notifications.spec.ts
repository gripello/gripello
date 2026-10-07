import type PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { reportAs } from '../../support/reports'
import {
    notificationsOf,
    openFromBell,
    waitForNotification,
    waitForNotificationOf,
} from '../../support/notifications'
import { createModerationGym, decide, openCase } from '../../support/moderation'

async function seededId(root: PocketBase, email: string) {
    return (
        await root
            .collection('users')
            .getFirstListItem(root.filter('email = {:email}', { email }))
    ).id
}

const mentions = (text: string) => (item: { params?: unknown }) =>
    JSON.stringify(item.params ?? {}).includes(text)

test('a report alerts the gym’s report handlers and leads to the inbox', async ({
    adminPage,
    userPage,
    root,
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
    const setter = await seededId(root, 'e2e-routesetter@gripello.test')
    expect(
        (await notificationsOf(root, setter, 'report_filed')).filter(
            mentions(text),
        ),
    ).toHaveLength(0)

    await gotoSettled(adminPage, gymPath('/manage/routes'))
    await openFromBell(adminPage, notice.id)
    await adminPage.waitForURL(/\/e2e\/manage\/moderation/)
})

test('legal reports reach the platform, “something else” stays with the gym', async ({
    adminPage,
    platformPage,
    userPage,
    root,
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
    const platform = await seededId(root, 'e2e-platform@gripello.test')
    expect(
        (await notificationsOf(root, platform, 'report_filed_platform')).filter(
            mentions(`${testPrefix}-other`),
        ),
    ).toHaveLength(0)

    await gotoSettled(platformPage, '/platform')
    await openFromBell(platformPage, escalation.id)
    await platformPage.waitForURL(/\/platform\/moderation/)
})

test('waiting uploads alert their gym and the decision reaches the uploader', async ({
    root,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const gym = await createModerationGym(root, testPrefix)
    try {
        await root
            .collection('gyms')
            .update(gym.id, { premoderate_betas: true })
        const setter = await seededId(root, 'e2e-routesetter@gripello.test')
        const before = (
            await notificationsOf(root, setter, 'moderation_pending')
        ).length
        const uploaderUser = await createUser('user', 'uploader')
        const uploader = await pageAs(uploaderUser)
        const headers = await authHeader(uploader)
        for (const suffix of ['yes', 'no']) {
            const res = await uploader.request.post(
                '/api/collections/beta_videos/records',
                {
                    headers,
                    data: {
                        route: gym.routeId,
                        user: uploaderUser.id,
                        url: `https://youtube.com/shorts/${testPrefix}-${suffix}`,
                    },
                },
            )
            expect(res.status()).toBe(202)
        }

        const staffNotice = await waitForNotificationOf(
            root,
            gym.staff.id,
            'moderation_pending',
        )
        expect(staffNotice.url).toBe(`/${gym.slug}/manage/moderation`)
        expect(
            (await notificationsOf(root, setter, 'moderation_pending')).length,
        ).toBe(before)

        const staff = await pageAs(gym.staff)
        const inbox = `/${gym.slug}/manage/moderation`
        await openCase(staff, `${testPrefix}-yes`, inbox, 'approval')
        await decide(staff, 'approve')
        await openCase(staff, `${testPrefix}-no`, inbox, 'approval')
        await decide(staff, 'reject', 'Wrong route.')

        const approved = await waitForNotificationOf(
            root,
            uploaderUser.id,
            'beta_approved',
        )
        expect(approved.url).toMatch(
            new RegExp(`^/route\\?id=${gym.routeId}#beta-`),
        )
        const rejected = await waitForNotificationOf(
            root,
            uploaderUser.id,
            'beta_rejected',
        )
        expect(JSON.stringify(rejected.params)).toContain('Wrong route.')

        await gotoSettled(uploader, '/logbook')
        await openFromBell(uploader, approved.id)
        await uploader.waitForURL(new RegExp(`/route\\?id=${gym.routeId}`))
    } finally {
        await root.collection('gyms').delete(gym.id)
    }
})

test('a hidden post notifies only its author', async ({
    adminPage,
    root,
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

    const notice = await waitForNotificationOf(
        root,
        authorUser.id,
        'content_hidden',
    )
    expect(JSON.stringify(notice.params)).toContain(`${testPrefix}-because`)
    expect(
        await notificationsOf(root, bystander.id, 'content_hidden'),
    ).toHaveLength(0)
})
