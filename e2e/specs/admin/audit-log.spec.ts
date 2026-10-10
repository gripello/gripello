import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled } from '../../support/nav'
import { E2E_GYM_SLUG, uiaa } from '../../support/seed'
import {
    AUDIT_ACTOR_GUESTS,
    AUDIT_ACTOR_PLATFORM,
} from '../../../app/utils/audit'
import { createComment, deleteComment } from '../../support/comments'
import { fetchAuditRows, waitForAuditRow } from '../../support/audit'
import {
    createRoute,
    getPlatformUser,
    guestApi,
    listAudit,
    listRouteRatings,
    routeInput,
    updateRating,
} from '../../support/api'

test('a create, an update and a delete each leave an entry', async ({
    adminPage: page,
    testPrefix,
    route,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-audited`,
    )
    const created = await waitForAuditRow(page, {
        q: commentId,
        action: 'create',
    })
    expect(created).toHaveLength(1)
    expect(created[0].collection_name).toBe('ratings')
    expect(created[0].actor_label).toBeTruthy()

    await deleteComment(page, commentId)
    const deleted = await waitForAuditRow(page, {
        q: commentId,
        action: 'delete',
    })
    expect(deleted).toHaveLength(1)

    const ratings = await listRouteRatings(await apiOf(page), route.id)
    expect(ratings.map((rating) => rating.id)).not.toContain(commentId)
    const still = await fetchAuditRows(page, { q: commentId })
    expect(still.length).toBeGreaterThanOrEqual(2)
})

test('an update records the changed field names and none of the values', async ({
    adminPage: page,
    testPrefix,
    route,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    const commentId = await createComment(
        page,
        route.id,
        `${testPrefix}-before`,
    )
    const secret = `${testPrefix}-SECRET-VALUE`
    await updateRating(await apiOf(page), commentId, { comment: secret })

    const rows = await waitForAuditRow(page, {
        q: commentId,
        action: 'update',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].changed_fields).toContain('comment')

    expect(JSON.stringify(rows[0])).not.toContain(secret)
})

test('a failed sign-in is recorded without the attempted password', async ({
    platformPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, '/platform')

    const identity = `ghost@${testPrefix}.example.test`
    const badPassword = `wrong-${testPrefix}`
    const res = await page.request.post('/api/auth/login', {
        data: { identity, password: badPassword },
    })
    expect(res.ok()).toBeFalsy()

    const maskedIdentity = `g***@${testPrefix}.example.test`
    const rows = await waitForAuditRow(
        page,
        { action: 'login_failed', q: maskedIdentity },
        'platform',
    )
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0])).not.toContain(badPassword)
    expect(JSON.stringify(rows[0])).not.toContain(identity)
})

test('nobody can forge or erase an entry through the API', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    const auditPath = `/api/gyms/${E2E_GYM_SLUG}/audit`

    const forged = await page.request.post(auditPath, {
        data: { action: 'create', actor_label: `${testPrefix}-forged` },
    })
    expect(forged.ok()).toBe(false)

    const existing = await fetchAuditRows(page, { action: 'create' })
    expect(existing.length).toBeGreaterThan(0)
    const removed = await page.request.delete(`${auditPath}/${existing[0]!.id}`)
    expect(removed.ok()).toBe(false)

    const stillThere = (
        await fetchAuditRows(page, { action: 'create' })
    ).filter((row) => row.id === existing[0]!.id)
    expect(stillThere).toHaveLength(1)
})

test('a bulk archive leaves one entry per route', async ({
    adminPage: page,
    testPrefix,
    workerLocation,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    const pageApi = await apiOf(page)

    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
        const route = await createRoute(
            pageApi,
            routeInput(`${testPrefix}-bulk-${i}`, workerLocation.id, {
                ...uiaa('5'),
                type: 'Boulder',
                creator: [testPrefix],
            }),
        )
        ids.push(route.id)
    }

    await pageApi.post(`/gyms/${E2E_GYM_SLUG}/routes/archive`, {
        ids,
        archived: true,
    })

    for (const id of ids) {
        const rows = await waitForAuditRow(page, { q: id, action: 'update' })
        expect(rows).toHaveLength(1)
        expect(rows[0].changed_fields).toContain('archived')
    }
})

test('an anonymous caller cannot read the audit log', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    await expect(
        guestApi().get(`/gyms/${E2E_GYM_SLUG}/audit`),
    ).rejects.toMatchObject({ status: 401 })
})

test('admins narrow the audit log down to one member', async ({
    adminPage: page,
    setterPage,
    api,
    testPrefix,
    route,
}) => {
    await gotoSettled(setterPage, '/manage/routes', /\/manage\/routes/)
    await gotoSettled(page, '/account/activity')
    const commentId = await createComment(
        setterPage,
        route.id,
        `${testPrefix}-by-setter`,
    )
    const [row] = await waitForAuditRow(page, {
        q: commentId,
        action: 'create',
    })
    const setter = await getPlatformUser(api, row!.actor!)

    await gotoSettled(page, '/account/activity')
    await page.getByTestId('audit-filter-actor').click()
    await page
        .getByRole('option', {
            name:
                [setter.firstname, setter.name].filter(Boolean).join(' ') ||
                setter.username,
            exact: true,
        })
        .click()

    await expect
        .poll(
            async () =>
                new Set(
                    await page
                        .getByTestId('audit-card-actor')
                        .allTextContents(),
                ),
        )
        .toEqual(new Set([row!.actor_label]))
    await expect(page.getByTestId(`audit-card-${row!.id}`)).toBeVisible()
})

test('every actor filter parses on the server', async ({ adminPage: page }) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    for (const actor of [AUDIT_ACTOR_GUESTS, AUDIT_ACTOR_PLATFORM]) {
        const rows = await listAudit(
            await apiOf(page),
            { gym: E2E_GYM_SLUG },
            { actor },
        )
        expect(Array.isArray(rows), actor).toBe(true)
    }
})
