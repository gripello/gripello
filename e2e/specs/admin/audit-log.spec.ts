import { createHash } from 'node:crypto'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, authHeader } from '../../support/nav'
import { uiaa } from '../../support/seed'
import { createComment, deleteComment } from '../../support/comments'
import {
    fetchAuditRows,
    fetchAuditRowsAnonymously,
    waitForAuditRow,
} from '../../support/audit'

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
    const created = await waitForAuditRow(
        page,
        `record_id = "${commentId}" && action = "create"`,
    )
    expect(created).toHaveLength(1)
    expect(created[0].collection_name).toBe('ratings')
    expect(created[0].actor_label).toBeTruthy()

    await deleteComment(page, commentId)
    const deleted = await waitForAuditRow(
        page,
        `record_id = "${commentId}" && action = "delete"`,
    )
    expect(deleted).toHaveLength(1)

    const gone = await page.request.get(
        `/api/collections/ratings/records/${commentId}`,
    )
    expect(gone.status()).toBe(404)
    const still = await fetchAuditRows(page, `record_id = "${commentId}"`)
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
    const res = await page.request.patch(
        `/api/collections/ratings/records/${commentId}`,
        {
            headers: await authHeader(page),
            data: { comment: secret },
        },
    )
    expect(res.ok()).toBeTruthy()

    const rows = await waitForAuditRow(
        page,
        `record_id = "${commentId}" && action = "update"`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].changed_fields).toContain('comment')

    expect(JSON.stringify(rows[0])).not.toContain(secret)
})

test('a failed sign-in is recorded without the attempted password', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    const identity = `ghost-${testPrefix}@example.test`
    const badPassword = `wrong-${testPrefix}`
    const res = await page.request.post(
        '/api/collections/users/auth-with-password',
        { data: { identity, password: badPassword } },
    )
    expect(res.ok()).toBeFalsy()

    const maskedIdentity = `unknown:${createHash('sha256').update(identity).digest('hex').slice(0, 8)}`
    const rows = await waitForAuditRow(
        page,
        `action = "login_failed" && actor_label = "${maskedIdentity}"`,
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
    const headers = await authHeader(page)

    const forged = await page.request.post(
        '/api/collections/audit_logs/records',
        {
            headers,
            data: { action: 'create', actor_label: `${testPrefix}-forged` },
        },
    )
    expect(forged.status()).toBe(403)

    const existing = await fetchAuditRows(page, 'action = "create"')
    expect(existing.length).toBeGreaterThan(0)
    const removed = await page.request.delete(
        `/api/collections/audit_logs/records/${existing[0].id}`,
        { headers },
    )
    expect(removed.status()).toBe(403)

    const stillThere = await fetchAuditRows(page, `id = "${existing[0].id}"`)
    expect(stillThere).toHaveLength(1)
})

test('a bulk archive leaves one entry per route', async ({
    adminPage: page,
    testPrefix,
    workerLocation,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    const headers = await authHeader(page)

    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
        const res = await page.request.post('/api/collections/routes/records', {
            headers,
            data: {
                name: `${testPrefix}-bulk-${i}`,
                ...uiaa('5'),
                location: workerLocation.id,
                type: 'Boulder',
                creator: [testPrefix],
            },
        })
        ids.push((await res.json()).id as string)
    }

    const batch = await page.request.post('/api/batch', {
        headers,
        data: {
            requests: ids.map((id) => ({
                method: 'PATCH',
                url: `/api/collections/routes/records/${id}`,
                body: { archived: true },
            })),
        },
    })
    expect(batch.ok()).toBeTruthy()

    for (const id of ids) {
        const rows = await waitForAuditRow(
            page,
            `record_id = "${id}" && action = "update"`,
        )
        expect(rows).toHaveLength(1)
        expect(rows[0].changed_fields).toContain('archived')
    }
})

test('an anonymous caller cannot read the audit log', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    const body = await fetchAuditRowsAnonymously(page)
    expect(body.totalItems ?? 0).toBe(0)
})

test('admins narrow the audit log down to one member', async ({
    adminPage: page,
    setterPage,
    root,
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
    const [row] = await waitForAuditRow(
        page,
        `record_id = "${commentId}" && action = "create"`,
    )
    const setter = await root.collection('users').getOne(row!.actor, {
        requestKey: null,
    })

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
