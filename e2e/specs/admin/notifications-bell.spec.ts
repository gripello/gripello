import type { Page } from '@playwright/test'
import type PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { createRole } from '../../support/seed'

async function waitForNotification(page: Page, marker: string) {
    const headers = await authHeader(page)
    let match: { id: string } | undefined
    await expect
        .poll(
            async () => {
                const res = await page.request.get(
                    '/api/collections/notifications/records?perPage=200&sort=-created',
                    { headers },
                )
                match = ((await res.json()).items ?? []).find(
                    (item: { params?: unknown }) =>
                        JSON.stringify(item.params ?? {}).includes(marker),
                )
                return !!match
            },
            { message: `notification carrying ${marker}` },
        )
        .toBe(true)
    return match!
}

const pbTime = () => new Date().toISOString().replace('T', ' ')

function decidedBetween(
    root: PocketBase,
    userId: string,
    from: string,
    to: string,
) {
    return root.collection('notifications').getFullList({
        filter: root.filter(
            'user = {:userId} && type ~ "report_decided" && created >= {:from} && created <= {:to}',
            { userId, from, to },
        ),
    })
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
    await createReport(page, {
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
    await createReport(page, {
        contentId: commentId,
        explanation: `${testPrefix}-read`,
    })

    const queued = await waitForNotification(page, `${testPrefix}-readme`)

    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    await page.getByTestId('notification-bell').click()
    await page.getByTestId(`notification-item-${queued.id}`).click()

    await page.waitForURL(/\/manage\/reports/)

    const headers = await authHeader(page)
    await expect
        .poll(async () => {
            const after = await page.request.get(
                `/api/collections/notifications/records/${queued.id}`,
                { headers },
            )
            return (await after.json()).read
        })
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
    await createReport(page, {
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

    const headers = await authHeader(page)
    await expect
        .poll(async () =>
            (
                await page.request.get(
                    `/api/collections/notifications/records/${queued.id}`,
                    { headers },
                )
            ).status(),
        )
        .toBe(404)
})

test('deciding a report notifies the other moderators exactly once', async ({
    root,
    route,
    testPrefix,
    createUser,
    pageAs,
}) => {
    const role = await createRole(root, `${testPrefix}-moderators`, [
        'manage_reports',
    ])
    const decider = await createUser(role.id, 'decider')
    const other = await createUser(role.id, 'other')
    const page = await pageAs(decider)

    await gotoSettled(page, '/manage/reports', /\/manage\/reports/)
    const commentId = await createComment(page, route.id, `${testPrefix}-once`)
    const reportId = await createReport(page, {
        contentId: commentId,
        explanation: `${testPrefix}-once`,
    })

    await gotoSettled(page, '/manage/reports')
    const card = page.getByTestId(`report-card-${reportId}`)
    await card.getByTestId('report-card-keep').click()
    await page
        .getByTestId('report-decision-reason')
        .first()
        .fill('Reviewed, no rule broken.')

    const decided = page.waitForResponse(
        (res) =>
            res.request().method() === 'PATCH' &&
            res.url().includes(`/api/collections/reports/records/${reportId}`),
    )
    const from = pbTime()
    await page.getByTestId('report-decision-confirm').click()
    expect((await decided).ok()).toBe(true)
    const to = pbTime()
    await expect(page.getByTestId('report-decision-dialog')).toBeHidden()

    expect(await decidedBetween(root, decider.id, from, to)).toHaveLength(0)
    expect(await decidedBetween(root, other.id, from, to)).toHaveLength(1)
})

test('a plain user with no notifications still gets a bell', async ({
    userPage: page,
}) => {
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
