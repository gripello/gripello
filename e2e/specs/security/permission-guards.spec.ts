import PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { e2eGymId, e2eRole, setMembership, uiaa } from '../../support/seed'
import { PB_URL } from '../../support/map'

async function clientWithPermission(
    root: PocketBase,
    prefix: string,
    permissionName: string,
) {
    const permission = await root
        .collection('permissions')
        .getFirstListItem(
            root.filter('name = {:name}', { name: permissionName }),
            { requestKey: null },
        )
    const role = await root.collection('roles').create({
        gym: await e2eGymId(root),
        name: `${prefix}-${permissionName}`,
        permissions: [permission.id],
    })
    const email = `${prefix}-${permissionName}@gripello.test`
    const password = 'E2ePassw0rd!'
    const user = await root.collection('users').create({
        email,
        password,
        passwordConfirm: password,
        verified: true,
        name: permissionName,
    })
    await setMembership(root, user.id, role.id)
    const client = new PocketBase(PB_URL)
    await client.collection('users').authWithPassword(email, password)
    return {
        client,
        userId: user.id,
        cleanup: async () => {
            await root.collection('users').delete(user.id)
            await root.collection('roles').delete(role.id)
        },
    }
}

test('climbers and setters only see their own account and membership', async ({
    createUser,
}) => {
    for (const role of ['user', 'routesetter']) {
        const seeded = await createUser(role, `list-${role}`)
        const client = new PocketBase(PB_URL)
        await client
            .collection('users')
            .authWithPassword(seeded.email, seeded.password)

        const users = await client.collection('users').getFullList()
        expect(users.map((user) => user.id)).toEqual([seeded.id])

        const memberships = await client.collection('memberships').getFullList()
        expect(memberships.map((membership) => membership.user)).toEqual(
            role === 'user' ? [] : [seeded.id],
        )
    }
})

test('a user manager cannot rename the admin role or strip its permissions', async ({
    root,
    testPrefix,
}) => {
    const admin = await e2eRole(root, 'admin')
    const manager = await clientWithPermission(root, testPrefix, 'manage_users')
    try {
        const roles = manager.client.collection('roles')
        await expect(
            roles.update(admin.id, { name: `${testPrefix}-owned` }),
        ).rejects.toMatchObject({ status: 403 })
        await expect(
            roles.update(admin.id, { permissions: [] }),
        ).rejects.toMatchObject({ status: 403 })
        await expect(
            roles.update(admin.id, { 'permissions-': admin.permissions[0] }),
        ).rejects.toMatchObject({ status: 403 })

        const unchanged = await root.collection('roles').getOne(admin.id)
        expect(unchanged.name).toBe('admin')
        expect(unchanged.permissions).toEqual(admin.permissions)
    } finally {
        await manager.cleanup()
    }
})

test('inventory may archive and restore routes but not edit them', async ({
    root,
    testPrefix,
    workerLocation,
}) => {
    const route = await root.collection('routes').create({
        name: `${testPrefix}-inventory`,
        ...uiaa('5'),
        location: workerLocation.id,
        type: 'Boulder',
        creator: ['E2E'],
    })
    const inventory = await clientWithPermission(
        root,
        testPrefix,
        'run_inventory',
    )
    try {
        const routes = inventory.client.collection('routes')
        const archived = await routes.update(route.id, { archived: true })
        expect(archived.archived).toBe(true)

        const backdate = await routes
            .update(route.id, { archived_at: '2000-01-01 00:00:00.000Z' })
            .then(
                () => 200,
                (err: { status: number }) => err.status,
            )
        expect([403, 404]).toContain(backdate)
        expect(
            (await root.collection('routes').getOne(route.id)).archived_at,
        ).toBe(archived.archived_at)
        const superuserBackdated = await root
            .collection('routes')
            .update(route.id, { archived_at: '2000-01-01 00:00:00.000Z' })
        expect(superuserBackdated.archived_at).toBe(archived.archived_at)

        await expect(
            routes.update(route.id, { archived: false, name: 'renamed' }),
        ).rejects.toMatchObject({ status: 403 })

        const restored = await routes.update(route.id, { archived: false })
        expect(restored.archived).toBe(false)
        expect(restored.name).toBe(`${testPrefix}-inventory`)
    } finally {
        await inventory.cleanup()
        await root.collection('routes').delete(route.id)
    }
})

test('a report handler without moderation rights cannot remove reported content', async ({
    adminPage: page,
    root,
    testPrefix,
    workerLocation,
}) => {
    const route = await root.collection('routes').create({
        name: `${testPrefix}-reported`,
        ...uiaa('5'),
        location: workerLocation.id,
        type: 'Boulder',
        creator: ['E2E'],
    })
    const reportResponse = await page.request.post(
        '/api/collections/reports/records',
        {
            data: {
                content_type: 'route',
                content_id: route.id,
                reason: 'other',
                explanation: `${testPrefix}-removal-guard`,
                notifier_name: 'E2E Reporter',
                notifier_email: 'e2e-reporter@example.com',
                good_faith: true,
            },
        },
    )
    const reportId = (await reportResponse.json()).id as string
    const moderator = await clientWithPermission(
        root,
        testPrefix,
        'manage_reports',
    )
    const decision = { status: 'actioned', decision: 'content_removed' }
    try {
        await expect(
            moderator.client.collection('routes').delete(route.id),
        ).rejects.toMatchObject({ status: 404 })
        await expect(
            moderator.client.collection('reports').update(reportId, decision),
        ).rejects.toMatchObject({ status: 403 })
        expect(
            (await root.collection('routes').getOne(route.id)).archived,
        ).toBe(false)

        // Deleting the content decides its open reports as removed.
        await root.collection('routes').delete(route.id)
        const decided = await root.collection('reports').getOne(reportId)
        expect(decided.status).toBe('actioned')
        expect(decided.decision).toBe('content_removed')
    } finally {
        await moderator.cleanup()
        await root.collection('reports').delete(reportId)
        await root
            .collection('routes')
            .delete(route.id)
            .catch(() => {})
    }
})

test('a decided report keeps its decision and server-owned fields', async ({
    root,
    route,
    testPrefix,
}) => {
    const rating = await root.collection('ratings').create({
        route_id: route.id,
        rating: 4,
        ...uiaa('5'),
        comment: `${testPrefix}-reported-rating`,
    })
    const { id: reportId } = await root.collection('reports').create({
        gym: await e2eGymId(root),
        content_type: 'rating',
        content_id: rating.id,
        reason: 'other',
        explanation: `${testPrefix}-decided-once`,
        notifier_name: 'E2E Reporter',
        notifier_email: 'e2e-reporter@example.com',
        good_faith: true,
    })
    const moderator = await clientWithPermission(
        root,
        testPrefix,
        'manage_reports',
    )
    try {
        const reports = moderator.client.collection('reports')
        const kept = await reports.update(reportId, {
            status: 'rejected',
            decision: 'content_kept',
            decided_by: '',
            decided_at: '2000-01-01 00:00:00.000Z',
            notifier_email: 'someone-else@example.com',
            content_snapshot: 'rewritten',
        })
        expect(kept.decided_by).toBe(moderator.userId)
        expect(kept.decided_at).not.toContain('2000-01-01')

        await expect(
            reports.update(reportId, {
                status: 'actioned',
                decision: 'content_removed',
            }),
        ).rejects.toMatchObject({ status: 400 })

        const stored = await root.collection('reports').getOne(reportId)
        expect(stored.decision).toBe('content_kept')
        expect(stored.notifier_email).toBe('e2e-reporter@example.com')
        expect(stored.content_snapshot).not.toBe('rewritten')
    } finally {
        await moderator.cleanup()
        await root.collection('reports').delete(reportId)
    }
})
