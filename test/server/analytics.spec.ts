import { describe, expect, it, vi } from 'vitest'

let authRefresh: () => Promise<unknown>

vi.mock('pocketbase', () => ({
    default: vi.fn(function () {
        return {
            authStore: { save: vi.fn(), isValid: true },
            collection: () => ({ authRefresh: () => authRefresh() }),
        }
    }),
}))
vi.mock('h3', () => ({
    createError: (input: unknown) => input,
    getHeader: () => 'Bearer token',
}))

const { requirePermission } = await import('../../server/utils/pb-server')

function memberWithRole(
    name: string,
    permissions: string[] = [],
    gym = 'gymA',
) {
    return {
        record: {
            expand: {
                memberships_via_user: [
                    {
                        gym,
                        expand: {
                            role: {
                                name,
                                expand: {
                                    permissions: permissions.map((entry) => ({
                                        name: entry,
                                    })),
                                },
                            },
                        },
                    },
                ],
            },
        },
    }
}

describe('requirePermission', () => {
    it('allows a member whose role has the permission', async () => {
        authRefresh = async () =>
            memberWithRole('routesetter', ['view_analytics'])
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).resolves.toBeDefined()
    })

    it('rejects the same role in another gym with 403', async () => {
        authRefresh = async () =>
            memberWithRole('routesetter', ['view_analytics'], 'gymB')
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects a user without memberships with 403', async () => {
        authRefresh = async () => ({ record: { expand: {} } })
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects a role named admin without the permission', async () => {
        authRefresh = async () => memberWithRole('admin')
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects a role without the permission with 403', async () => {
        authRefresh = async () => memberWithRole('setter', ['manage_routes'])
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({
            statusCode: 403,
        })
    })

    it('rejects a token PocketBase does not accept with 401', async () => {
        authRefresh = async () => {
            throw Object.assign(new Error('invalid'), { status: 401 })
        }
        const caught = await requirePermission(
            {} as never,
            'view_analytics',
            'gymA',
        ).catch((e) => e)
        expect(caught).toMatchObject({ statusCode: 401 })
    })

    it('reports an unreachable PocketBase as 503', async () => {
        authRefresh = async () => {
            throw Object.assign(new Error('fetch failed'), { status: 0 })
        }
        const caught = await requirePermission(
            {} as never,
            'view_analytics',
            'gymA',
        ).catch((e) => e)
        expect(caught).toMatchObject({ statusCode: 503 })
    })
})
