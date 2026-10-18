import { test, expect } from '../../support/fixtures'
import { decide, openCase } from '../../support/moderation'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { signInAs } from '../../support/auth'
import { waitForNotification } from '../../support/notifications'
import { createRole, listNotifications, type Api } from '../../support/api'

async function decidedSince(api: Api, from: number) {
    return (await listNotifications(api)).filter(
        (item) =>
            item.type.includes('report_decided') &&
            Date.parse(item.created ?? '') >= from,
    ).length
}

test('a filed report raises a notification linking to the queue', async ({
    adminPage: page,
    route,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-belled`,
    )
    await createReport({
        contentId: commentId,
        explanation: `${testPrefix}-bell`,
    })

    await waitForNotification(page, `${testPrefix}-belled`)

    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    await expect(page.getByTestId('notification-bell')).toBeVisible()

    await page.getByTestId('notification-bell').click()
    const menu = page.getByTestId('notification-menu')
    await expect(menu).toBeVisible()
    await expect(menu).toContainText(`${testPrefix}-belled`)
})

test('opening a notification marks it read and clears the badge', async ({
    adminPage: page,
    route,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-readme`,
    )
    await createReport({
        contentId: commentId,
        explanation: `${testPrefix}-read`,
    })

    const queued = await waitForNotification(page, `${testPrefix}-readme`)

    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    await page.getByTestId('notification-bell').click()
    await page.getByTestId(`notification-item-${queued.id}`).click()

    await page.waitForURL(/\/manage\/moderation/)

    const pageApi = await apiOf(page)
    await expect
        .poll(
            async () =>
                (await listNotifications(pageApi)).find(
                    (item) => item.id === queued.id,
                )?.read,
        )
        .toBe(true)
})

test('dismissing a notification removes it from the list', async ({
    adminPage: page,
    route,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-dismissme`,
    )
    await createReport({
        contentId: commentId,
        explanation: `${testPrefix}-dismiss`,
    })

    const queued = await waitForNotification(page, `${testPrefix}-dismissme`)

    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    await page.getByTestId('notification-bell').click()

    const row = page.getByTestId(`notification-item-${queued.id}`)
    await expect(row).toBeVisible()
    await row.getByTestId('notification-dismiss').click()

    await expect(row).toBeHidden()
    await expect(page.getByTestId('notification-bell')).toBeVisible()

    const pageApi = await apiOf(page)
    await expect
        .poll(async () =>
            (await listNotifications(pageApi)).some(
                (item) => item.id === queued.id,
            ),
        )
        .toBe(false)
})

test('deciding a report notifies the other moderators exactly once', async ({
    adminApi,
    apiAs,
    route,
    testPrefix,
    createUser,
    pageAs,
}) => {
    const role = await createRole(adminApi, `${testPrefix}-moderators`, [
        'manage_reports',
        'manage_comments',
    ])
    const decider = await createUser(role.id, 'decider')
    const other = await createUser(role.id, 'other')
    const page = await pageAs(decider)

    await gotoSettled(page, '/manage/moderation')
    const commentId = await createComment(page, route.id, `${testPrefix}-once`)
    await createReport({
        contentId: commentId,
        explanation: `${testPrefix}-once`,
    })

    await openCase(page, `${testPrefix}-once`)
    const decided = page.waitForResponse(
        (res) =>
            res.request().method() === 'POST' &&
            /\/api\/moderation\/[^/]+$/.test(new URL(res.url()).pathname),
    )
    const from = Date.now() - 1_000
    await decide(page, 'approve')
    expect((await decided).ok()).toBe(true)

    // Parallel tests decide reports in the same gym and notify both moderators in one insert, so only the decider's own decision makes their counts differ.
    const otherApi = await apiAs(other)
    const deciderApi = await apiAs(decider)
    await expect
        .poll(
            async () =>
                (await decidedSince(otherApi, from)) -
                (await decidedSince(deciderApi, from)),
        )
        .toBe(1)
})

test('a plain user with no notifications still gets a bell', async ({
    page,
    createUser,
}) => {
    const climber = await createUser('user', 'bell')
    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, gymPath('/'))

    await expect(page.getByTestId('notification-bell')).toBeVisible()
    await expect(page.getByTestId('notification-badge')).toBeHidden()

    await page.getByTestId('notification-bell').click()
    await expect(page.getByTestId('notification-empty')).toBeVisible()
})

test('menu keeps a readable width and fits on phones', async ({
    adminPage: page,
}) => {
    for (const viewport of [
        { width: 1440, height: 900, minWidth: 340 },
        { width: 360, height: 780, minWidth: 320 },
    ]) {
        await page.setViewportSize(viewport)
        await gotoSettled(page, gymPath('/'))
        await page.getByTestId('notification-bell').click()
        const menuLocator = page.getByTestId('notification-menu')
        await expect
            .poll(async () => (await menuLocator.boundingBox())?.width ?? 0)
            .toBeGreaterThanOrEqual(viewport.minWidth)
        const menu = (await menuLocator.boundingBox())!
        expect(menu.x).toBeGreaterThanOrEqual(0)
        expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width)
        await page.keyboard.press('Escape')
    }
})
