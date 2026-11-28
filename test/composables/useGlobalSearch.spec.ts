import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
    listRoutes: vi.fn(),
    listMembers: vi.fn(),
    listRoles: vi.fn(),
    listGymRatings: vi.fn(),
    listModerationCases: vi.fn(),
}))
vi.mock('~/api/routes', () => ({ listRoutes: api.listRoutes }))
vi.mock('~/api/members', () => ({
    listMembers: api.listMembers,
    listRoles: api.listRoles,
}))
vi.mock('~/api/ratings', () => ({ listGymRatings: api.listGymRatings }))
vi.mock('~/api/moderation', () => ({
    listModerationCases: api.listModerationCases,
}))

let granted: string[] = []

beforeEach(() => {
    granted = []
    vi.stubGlobal('useCurrentGymId', () => ({ value: 'gymA' }))
    vi.stubGlobal('useGymPath', () => (path: string) => `/gym-a${path}`)
    vi.stubGlobal('usePermissions', () => ({
        can: (perm: string) => granted.includes(perm),
    }))
    vi.stubGlobal('useI18n', () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params
                ? `${key}:${JSON.stringify(params)}`
                : ({
                      'settings.contactEmail': 'Contact e-mail',
                      'settings.organization': 'Organisation',
                      'gymInfo.settings.contacts': 'Contacts',
                  }[key] ?? key),
    }))
    api.listRoutes.mockResolvedValue({
        items: [
            {
                id: 'r1',
                name: 'Crimp',
                grade: '6a',
                grade_system: 'french',
                creator: ['Ann', 'Bo'],
                color: '#ff0000',
            },
        ],
    })
    api.listMembers.mockResolvedValue({
        items: [{ user: { id: 'u1', email: 'a+b@x.de', username: 'ann' } }],
    })
    api.listRoles.mockResolvedValue([{ id: 'ro1', name: 'Setter' }])
    api.listGymRatings.mockResolvedValue({
        items: [{ id: 'ra1', comment: `  long\n${'x'.repeat(100)}` }],
    })
    api.listModerationCases.mockResolvedValue({ items: [] })
})

const search = async (query: string) => {
    const { useGlobalSearch } = await import('~/composables/useGlobalSearch')
    return useGlobalSearch().search(query)
}

describe('useGlobalSearch', () => {
    it('searches nothing for a blank query', async () => {
        expect(await search('   ')).toEqual([])
        expect(api.listRoutes).not.toHaveBeenCalled()
    })

    it('only queries the sources the viewer may see', async () => {
        const groups = await search('crimp')
        expect(groups.map((g) => g.key)).toEqual(['routes'])
        expect(api.listMembers).not.toHaveBeenCalled()
        expect(api.listGymRatings).not.toHaveBeenCalled()

        granted = ['manage_users', 'manage_comments', 'manage_settings']
        expect((await search('crimp')).map((g) => g.key)).toEqual([
            'routes',
            'users',
            'roles',
            'reviews',
            'moderation',
            'settings',
        ])
    })

    it('links results into the current gym', async () => {
        granted = ['manage_users', 'manage_comments']
        const groups = await search(' a+b ')
        const items = Object.fromEntries(groups.map((g) => [g.key, g.items]))

        expect(api.listRoutes).toHaveBeenCalledWith(
            'gymA',
            expect.objectContaining({ q: 'a+b', limit: 8 }),
        )
        expect(items.routes![0]).toMatchObject({
            to: '/gym-a/route?id=r1',
            title: 'Crimp',
            subtitle: '6a · Ann, Bo',
        })
        expect(items.users![0]!.to).toBe(
            '/gym-a/admin/users?search=a%2Bb%40x.de',
        )
        expect(items.reviews![0]).toMatchObject({
            to: '/gym-a/manage/comments?search=a%2Bb',
            title: `long ${'x'.repeat(75)}…`,
        })
    })

    it('keeps the other groups when one source fails and reports the failure', async () => {
        granted = ['manage_users']
        const down = Object.assign(new Error('down'), { status: 500 })
        api.listMembers.mockRejectedValue(down)
        const groups = await search('crimp')
        const users = groups.find((g) => g.key === 'users')!
        expect(users.items).toEqual([])
        expect(users.error).toBe(down)
        expect(groups.find((g) => g.key === 'roles')).not.toHaveProperty(
            'error',
        )
        expect(groups.find((g) => g.key === 'roles')!.items).toHaveLength(1)
    })

    it('links to all routes when the search finds more than it shows', async () => {
        api.listRoutes.mockResolvedValue({
            items: [{ id: 'r1', name: 'Crimp', creator: [] }],
            total: 23,
        })
        const [routes] = await search('crimp')
        expect(api.listRoutes).toHaveBeenCalledWith(
            'gymA',
            expect.objectContaining({ total: true }),
        )
        expect(routes!.items.at(-1)).toEqual({
            key: 'routes-all',
            to: '/gym-a/routes',
            icon: 'i-lucide-list',
            title: 'nav.paletteAllRoutes:{"n":23}',
        })

        api.listRoutes.mockResolvedValue({
            items: [{ id: 'r1', name: 'Crimp', creator: [] }],
            total: 1,
        })
        const [single] = await search('crimp')
        expect(single!.items.map((item) => item.key)).toEqual(['route-r1'])
    })

    it('finds settings by their translated label', async () => {
        granted = ['manage_settings']
        const settings = (await search('E-MAIL')).find(
            (g) => g.key === 'settings',
        )!
        expect(settings.items).toEqual([
            expect.objectContaining({
                title: 'Contact e-mail',
                subtitle: 'Contacts',
                to: '/gym-a/admin/settings?section=contacts',
            }),
        ])
    })
})

describe('searchFailureKey', () => {
    const groups = (error?: unknown) => [
        { key: 'routes', label: 'r', items: [] },
        { key: 'users', label: 'u', items: [], error },
    ]

    it('is null while every source answered', async () => {
        const { searchFailureKey } =
            await import('~/composables/useGlobalSearch')
        expect(searchFailureKey(groups())).toBeNull()
    })

    it('names offline, rate-limited and other failures', async () => {
        const { searchFailureKey } =
            await import('~/composables/useGlobalSearch')
        expect(searchFailureKey(groups({ status: 0 }))).toBe(
            'errors.offline.title',
        )
        expect(searchFailureKey(groups({ status: 429 }))).toBe(
            'errors.rateLimited',
        )
        expect(searchFailureKey(groups({ status: 500 }))).toBe(
            'errors.loadFailed',
        )
    })
})
