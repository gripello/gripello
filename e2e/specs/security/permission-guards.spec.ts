import { test, expect } from '../../support/fixtures'
import { staffOf } from '../../support/moderation'
import {
    ApiError,
    apiAs,
    archiveRoute,
    createRating,
    decideModerationCase,
    deleteRoute,
    e2eGymId,
    fileReport,
    findReport,
    findRole,
    getMe,
    getRoute,
    guestApi,
    openModerationCase,
    setRolePermissions,
    updateRoute,
} from '../../support/api'

const statusOf = (request: Promise<unknown>) =>
    request.then(
        () => 200,
        (error: ApiError) => error.status,
    )

async function apiWithPermission(prefix: string, permission: string) {
    const user = await staffOf(
        await e2eGymId(),
        [permission],
        `${prefix}-${permission}`,
    )
    return { api: await apiAs(user), userId: user.id }
}

test('climbers and setters only see their own account and membership', async ({
    apiAs,
    createUser,
}) => {
    for (const role of ['user', 'routesetter']) {
        const seeded = await createUser(role, `list-${role}`)
        const client = await apiAs(seeded)

        expect((await getMe(client)).id).toBe(seeded.id)
        await expect(client.get('/platform/users')).rejects.toMatchObject({
            status: 403,
        })
        await expect(
            client.get(`/gyms/${await e2eGymId()}/members`),
        ).rejects.toMatchObject({ status: 403 })

        const memberships =
            await client.get<{ gym: { id: string } }[]>('/me/memberships')
        expect(memberships.map((membership) => membership.gym.id)).toEqual(
            role === 'user' ? [] : [await e2eGymId()],
        )
    }
})

test('a user manager cannot rename the admin role or strip its permissions', async ({
    adminApi,
    testPrefix,
}) => {
    const admin = await findRole(adminApi, 'admin')
    const manager = await apiWithPermission(testPrefix, 'manage_users')

    await expect(
        manager.api.patch(`/roles/${admin.id}`, {
            name: `${testPrefix}-owned`,
        }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
        setRolePermissions(manager.api, admin.id, []),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
        setRolePermissions(manager.api, admin.id, admin.permissions.slice(1)),
    ).rejects.toMatchObject({ status: 403 })

    const unchanged = await findRole(adminApi, 'admin')
    expect(unchanged.name).toBe('admin')
    expect(unchanged.permissions).toEqual(admin.permissions)
})

test('inventory may archive and restore routes but not edit them', async ({
    adminApi,
    createRoute,
    testPrefix,
}) => {
    const route = await createRoute({
        name: `${testPrefix}-inventory`,
        type: 'Boulder',
    })
    const inventory = (await apiWithPermission(testPrefix, 'run_inventory')).api

    const archived = await archiveRoute(inventory, route.id)
    expect(archived.archived).toBe(true)

    expect([400, 403, 404]).toContain(
        await statusOf(
            updateRoute(inventory, route.id, {
                archived_at: '2000-01-01T00:00:00.000Z',
            }),
        ),
    )
    expect((await getRoute(adminApi, route.id)).archived_at).toBe(
        archived.archived_at,
    )
    const adminBackdated = await updateRoute(adminApi, route.id, {
        archived_at: '2000-01-01T00:00:00.000Z',
    }).catch(() => getRoute(adminApi, route.id))
    expect(adminBackdated.archived_at).toBe(archived.archived_at)

    await expect(
        updateRoute(inventory, route.id, { archived: false, name: 'renamed' }),
    ).rejects.toMatchObject({ status: 403 })

    const restored = await archiveRoute(inventory, route.id, false)
    expect(restored.archived).toBe(false)
    expect(restored.name).toBe(`${testPrefix}-inventory`)
})

test('a report handler without moderation rights cannot remove reported content', async ({
    api,
    adminApi,
    createRoute,
    testPrefix,
}) => {
    const route = await createRoute({
        name: `${testPrefix}-reported`,
        type: 'Boulder',
    })
    const { id: reportId } = await fileReport(guestApi(), {
        contentType: 'route',
        contentId: route.id,
        reason: 'other',
        explanation: `${testPrefix}-removal-guard`,
    })
    const moderator = (await apiWithPermission(testPrefix, 'manage_reports'))
        .api
    const item = await openModerationCase(adminApi, 'route', route.id)

    expect([403, 404]).toContain(
        await statusOf(deleteRoute(moderator, route.id)),
    )
    await expect(
        decideModerationCase(moderator, item.id, 'hide', 'Removed.'),
    ).rejects.toMatchObject({ status: 404 })
    expect((await getRoute(adminApi, route.id)).archived).toBe(false)

    // Deleting the content decides its open reports as removed.
    await deleteRoute(adminApi, route.id)
    await expect
        .poll(async () => (await findReport(api, reportId))?.status)
        .toBe('actioned')
    expect((await findReport(api, reportId))?.decision).toBe('content_removed')
})

test('a decided report keeps its decision and server-owned fields', async ({
    api,
    adminApi,
    route,
    testPrefix,
}) => {
    const rating = await createRating(adminApi, route.id, {
        rating: 4,
        comment: `${testPrefix}-reported-rating`,
    })
    const { id: reportId } = await fileReport(guestApi(), {
        contentType: 'rating',
        contentId: rating.id,
        reason: 'other',
        explanation: `${testPrefix}-decided-once`,
    })
    const moderator = await apiWithPermission(testPrefix, 'manage_comments')
    const item = await openModerationCase(moderator.api, 'rating', rating.id)

    await decideModerationCase(moderator.api, item.id, 'approve')
    const kept = await findReport(api, reportId)
    expect(kept?.status).toBe('rejected')
    expect(kept?.decision).toBe('content_kept')
    expect(kept?.decided_by).toBe(moderator.userId)
    expect(kept?.decided_at).toBeTruthy()

    await decideModerationCase(moderator.api, item.id, 'hide', 'Changed.')

    const stored = await findReport(api, reportId)
    expect(stored?.decision).toBe('content_kept')
    expect(stored?.notifier_email).toBe('e2e-reporter@example.com')
    expect(stored?.content_snapshot).toContain(`${testPrefix}-reported-rating`)
})
