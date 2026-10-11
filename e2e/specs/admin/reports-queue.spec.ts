import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled } from '../../support/nav'
import { E2E_GYM_SLUG } from '../../support/seed'
import { findReport, listReports, listRouteRatings } from '../../support/api'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { decide, openCase } from '../../support/moderation'

test('a report shows up in the inbox with its notice details', async ({
    adminPage: page,
    route,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/moderation')
    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-reported`,
    )
    await createReport({
        contentId: commentId,
        explanation: `${testPrefix}-explanation`,
    })

    const detail = await openCase(page, `${testPrefix}-reported`)
    await expect(detail).toContainText(`${testPrefix}-explanation`)
    await expect(detail).toContainText('Spam or fraud')
})

test('hiding a reported comment closes the report', async ({
    adminPage: page,
    adminApi,
    route,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/moderation')
    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-remove-me`,
    )
    const reportId = await createReport({
        contentId: commentId,
        explanation: `${testPrefix}-remove`,
    })

    await openCase(page, `${testPrefix}-remove-me`)
    await decide(page, 'hide', 'Breaches the rules.')

    await expect
        .poll(
            async () =>
                (await findReport(adminApi, reportId, E2E_GYM_SLUG))?.status,
        )
        .toBe('actioned')
    const ratings = await listRouteRatings(adminApi, route.id)
    expect(ratings.map((rating) => rating.id)).not.toContain(commentId)
})

test('keeping a reported comment rejects the report and leaves it in place', async ({
    adminPage: page,
    adminApi,
    route,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/moderation')
    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-keep-me`,
    )
    const reportId = await createReport({
        contentId: commentId,
        explanation: `${testPrefix}-keep`,
    })

    await openCase(page, `${testPrefix}-keep-me`)
    await decide(page, 'approve')

    await expect
        .poll(
            async () =>
                (await findReport(adminApi, reportId, E2E_GYM_SLUG))?.status,
        )
        .toBe('rejected')
    const ratings = await listRouteRatings(adminApi, route.id)
    expect(ratings.map((rating) => rating.id)).toContain(commentId)
})

test('the old reports address leads to the inbox', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/reports')
    await page.waitForURL(/\/manage\/moderation/)
})

test('a user without moderation rights cannot reach the inbox or reports', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/manage/moderation')
    await page.waitForURL((url) => !url.pathname.endsWith('/manage/moderation'))

    await expect(
        listReports(await apiOf(page), {}, E2E_GYM_SLUG),
    ).rejects.toMatchObject({ status: 403 })
})
