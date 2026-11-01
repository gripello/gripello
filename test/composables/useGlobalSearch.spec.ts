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
        t: (key: string) =>
            ({
                'settings.contactEmail': 'Contact e-mail',
                'settings.organization': 'Organisation',
            })[key] ?? key,
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

    it('keeps the other groups when one source fails', async () => {
        granted = ['manage_users']
        api.listMembers.mockRejectedValue(new Error('down'))
        const groups = await search('crimp')
        expect(groups.find((g) => g.key === 'users')!.items).toEqual([])
        expect(groups.find((g) => g.key === 'roles')!.items).toHaveLength(1)
    })

    it('finds settings by their translated label', async () => {
        granted = ['manage_settings']
        const settings = (await search('E-MAIL')).find(
            (g) => g.key === 'settings',
        )!
        expect(settings.items).toEqual([
            expect.objectContaining({
                title: 'Contact e-mail',
                subtitle: 'Organisation',
                to: '/gym-a/admin/settings?section=organization',
            }),
        ])
    })
})
