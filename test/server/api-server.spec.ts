import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, mockApi } from '../api/apiMock'

let authorization = 'Bearer token'

vi.mock('h3', () => ({
    createError: (input: unknown) => input,
    getHeader: () => authorization,
}))

const { apiFetch, fetchAll, requirePermission } =
    await import('../../server/utils/api-server')

let api: ReturnType<typeof mockApi>

function memberWithRole(permissions: string[] = [], gym = 'gymA') {
    return [{ gym: { id: gym }, role: { name: 'setter', permissions } }]
}

beforeEach(() => {
    api = mockApi()
    authorization = 'Bearer token'
    globalThis.__NUXT_RUNTIME_CONFIG__ = {
        apiBase: 'http://go',
        public: { appVersion: '1.5.0' },
    }
})

describe('apiFetch', () => {
    it('forwards the caller token to the Go API', async () => {
        authorization = 'raw-token'
        await apiFetch({} as never)('/me')
        expect(api.request().url).toBe('http://go/api/me')
        expect(api.request().headers.get('Authorization')).toBe(
            'Bearer raw-token',
        )
        expect(api.request().headers.get('X-Gripello-Api-Version')).toBe(
            '1.5.0',
        )
        await apiFetch()('/gyms')
        expect(api.request().headers.has('Authorization')).toBe(false)
    })

    it('pages through a list until a short page', async () => {
        api.respond({ items: [1, 2] })
        api.respond({ items: [3] })
        expect(
            await fetchAll(apiFetch(), '/gyms/g/routes', { a: 'b' }, 2),
        ).toEqual([1, 2, 3])
        expect(api.request().url).toBe(
            'http://go/api/gyms/g/routes?a=b&page=2&limit=2',
        )
    })
})

describe('requirePermission', () => {
    it('allows a member whose role has the permission', async () => {
        api.respond(memberWithRole(['view_analytics']))
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).resolves.toBeTypeOf('function')
        expect(api.request().url).toBe('http://go/api/me/memberships')
    })

    it('rejects the same role in another gym with 403', async () => {
        api.respond(memberWithRole(['view_analytics'], 'gymB'))
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects a role without the permission with 403', async () => {
        api.respond(memberWithRole(['manage_routes']))
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('rejects a request without a token with 401', async () => {
        authorization = ''
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({ statusCode: 401 })
        expect(api.fetchMock).not.toHaveBeenCalled()
    })

    it('rejects a token the API does not accept with 401', async () => {
        api.respond({ status: 401, message: 'no', data: {} }, 401)
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({ statusCode: 401 })
    })

    it('reports an unreachable API as 503', async () => {
        api.fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({ statusCode: 503 })
        api.fetchMock.mockResolvedValueOnce(jsonResponse({}, 502))
        await expect(
            requirePermission({} as never, 'view_analytics', 'gymA'),
        ).rejects.toMatchObject({ statusCode: 503 })
    })
})
