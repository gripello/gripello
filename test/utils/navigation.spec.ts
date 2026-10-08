import { describe, expect, it } from 'vitest'
import {
    PLATFORM_ADMIN,
    gymLink,
    sectionTabs,
    sidebarSections,
    zoneOfPath,
    gymLocalPath,
    staffSections,
    visibleNavItems,
    withGym,
    withGymSlug,
    gymSwitchPath,
    bottomNavLinks,
    navContext,
    requestedSection,
} from '~/utils/navigation'

const allowing =
    (...permissions: string[]) =>
    (permission: string) =>
        permissions.includes(permission)

describe('withGym', () => {
    it('prefixes tenant links and keeps the unprefixed path', () => {
        expect(
            withGym(
                [
                    { to: '/' },
                    { to: '/routes' },
                    { to: '/logbook' },
                    { to: '/account/settings' },
                    { to: '/scan' },
                ],
                'gym-a',
            ),
        ).toEqual([
            { to: '/gym-a', path: '/' },
            { to: '/gym-a/routes', path: '/routes' },
            { to: '/logbook', path: '/logbook' },
            { to: '/account/settings', path: '/account/settings' },
            { to: '/scan', path: '/scan' },
        ])
    })

    it('prefixes children of groups', () => {
        const [group] = withGym(
            [{ children: [{ to: '/manage/tasks', icon: '', label: '' }] }],
            'gym-a',
        )
        expect(group!.children![0]!.to).toBe('/gym-a/manage/tasks')
    })

    it('drops tenant links when no gym is selected', () => {
        expect(
            withGym([{ to: '/' }, { to: '/map' }, { to: '/logbook' }], '').map(
                (item) => item.to,
            ),
        ).toEqual(['/', '/logbook'])
    })

    it('builds single links', () => {
        expect(gymLink('/manage/routes', 'gym-a')).toBe('/gym-a/manage/routes')
        expect(gymLink('/scan', 'gym-a')).toBe('/scan')
        expect(gymLink('/map', '')).toBe('/map')
    })
})

describe('visibleNavItems', () => {
    it('drops links and empty groups the role cannot open', () => {
        const items = visibleNavItems(allowing(), true, 'gym-a')
        expect(items.map((item) => item.to)).toEqual([
            '/gym-a',
            '/gym-a/routes',
            '/gym-a/map',
            '/gym-a/info',
            '/gym-a/feed',
            '/gym-a/leaderboard',
            '/gym-a/competitions',
            '/friends',
            '/logbook',
        ])
    })

    it('shows guests only the public pages', () => {
        const items = visibleNavItems(allowing(), false, 'gym-a')
        expect(items.map((item) => item.key)).toEqual([
            'home',
            'list',
            'map',
            'info',
            'feed',
            'leaderboard',
            'competitions',
        ])
    })

    it('keeps only the landing page and personal pages outside a gym', () => {
        const keys = visibleNavItems(allowing('manage_routes'), true).map(
            (item) => item.key,
        )
        expect(keys).toEqual(['home', 'friends', 'logbook'])
    })
})

describe('staffSections', () => {
    it('puts route management first and hides empty sections', () => {
        const sections = staffSections(allowing('manage_routes'), 'gym-a')
        expect(sections.map((section) => section.key)).toEqual(['manage'])
        expect(sections[0]!.links.map((link) => link.to)).toEqual([
            '/gym-a/manage/routes',
            '/gym-a/manage/map',
        ])
    })

    it('gives admins every section', () => {
        const all = allowing(
            'manage_routes',
            'manage_comments',
            'manage_settings',
            'manage_users',
        )
        expect(
            staffSections(all, 'gym-a').map((section) => section.key),
        ).toEqual(['manage', 'moderation', 'admin'])
    })

    it('groups moderation apart from route setting', () => {
        const sections = staffSections(
            allowing('manage_comments', 'manage_reports', 'view_analytics'),
            'gym-a',
        )
        expect(
            sections.map((section) => [
                section.key,
                section.links.map((link) => link.path),
            ]),
        ).toEqual([
            ['manage', ['/manage/analytics']],
            ['moderation', ['/manage/moderation', '/manage/comments']],
        ])
    })

    it('puts the open case count on the moderation links', () => {
        const { sections } = sidebarSections(
            allowing('manage_comments'),
            true,
            'gym-a',
            '/gym-a/manage',
            (key) => key,
            'staff',
            '',
            { moderation: 4 },
        )
        const links = sections.flatMap((section) => section.items)
        expect(
            links.find((link) => link.to.endsWith('/manage/moderation'))?.badge,
        ).toBe('4')
        expect(
            links.find((link) => link.to.endsWith('/manage/comments'))?.badge,
        ).toBeUndefined()
    })

    it('returns nothing for climbers or without a gym', () => {
        expect(staffSections(allowing(), 'gym-a')).toEqual([])
        expect(staffSections(allowing('manage_routes'))).toEqual([])
    })
})

describe('platform section', () => {
    it('is hidden from gym staff', () => {
        const all = allowing('manage_users', 'manage_settings')
        expect(
            staffSections(all, 'gym-a').map((section) => section.key),
        ).not.toContain('platform')
    })

    it('stays out of the gym sidebar and staff sections', () => {
        for (const slug of ['gym-a', '']) {
            expect(staffSections(allowing(PLATFORM_ADMIN), slug)).toEqual([])
        }
        const nav = sidebarSections(
            allowing(PLATFORM_ADMIN),
            true,
            'gym-a',
            '/gym-a/routes',
            (key) => key,
            'gym',
        )
        expect(nav.sections.map((section) => section.key)).toEqual([
            'gym',
            'community',
            'you',
        ])
        expect(nav.staffEntry).toBeNull()
    })

    it('stays reachable from the command palette with unprefixed links', () => {
        const platform = visibleNavItems(
            allowing(PLATFORM_ADMIN),
            true,
            'gym-a',
        )
            .find((item) => item.key === 'platform')!
            .children!.map((link) => link.to)
        expect(platform).toEqual([
            '/platform',
            '/platform/moderation',
            '/platform/gyms',
            '/platform/users',
            '/platform/settings',
        ])
        expect(
            visibleNavItems(allowing('manage_users'), true, 'gym-a').map(
                (item) => item.key,
            ),
        ).not.toContain('platform')
    })
})

describe('withGymSlug', () => {
    it('swaps the gym segment and keeps path, query and hash', () => {
        expect(withGymSlug('/old', 'new')).toBe('/new')
        expect(withGymSlug('/old/manage/tasks?status=open#top', 'new')).toBe(
            '/new/manage/tasks?status=open#top',
        )
        expect(withGymSlug('/old?tab=1', 'new')).toBe('/new?tab=1')
    })
})

describe('gymSwitchPath', () => {
    it('keeps the page but drops the query', () => {
        expect(gymSwitchPath('/old', 'new', false)).toBe('/new')
        expect(gymSwitchPath('/old/manage/tasks', 'new', false)).toBe(
            '/new/manage/tasks',
        )
    })

    it('opens the section root instead of a record of the old gym', () => {
        expect(gymSwitchPath('/old/competitions/c1/tv', 'new', true)).toBe(
            '/new/competitions',
        )
        expect(gymSwitchPath('/old/route', 'new', true)).toBe('/new/routes')
        expect(
            gymSwitchPath('/old/manage/competitions/c1/judge', 'new', true),
        ).toBe('/new/manage/competitions')
    })
})

describe('sidebarSections', () => {
    const t = (key: string) => `t:${key}`
    const testids = (items: { testid: string }[]) =>
        items.map((item) => item.testid)

    it('splits climber pages into gym, community and you', () => {
        const { sections, staffEntry } = sidebarSections(
            allowing('manage_routes'),
            true,
            'gym-a',
            '/gym-a/routes',
            t,
            'gym',
            'me',
        )
        expect(
            sections.map((section) => [section.label, testids(section.items)]),
        ).toEqual([
            [
                't:nav.gym',
                [
                    'nav-link-home',
                    'nav-link-routes',
                    'nav-link-map',
                    'nav-link-info',
                ],
            ],
            [
                't:nav.community',
                [
                    'nav-link-feed',
                    'nav-link-leaderboard',
                    'nav-link-competitions',
                    'nav-link-friends',
                ],
            ],
            ['t:nav.you', ['nav-link-logbook', 'nav-link-climber']],
        ])
        expect(staffEntry).toBe('/gym-a/manage')
    })

    it('keeps the same zones on personal pages and hides staff for climbers', () => {
        const { sections, staffEntry } = sidebarSections(
            allowing(),
            true,
            'gym-a',
            '/friends',
            t,
            'global',
        )
        expect(sections[0]!.items[0]).toMatchObject({ to: '/gym-a' })
        expect(staffEntry).toBeNull()
    })

    it('lists only the staff sections in the staff workspace', () => {
        const { sections } = sidebarSections(
            allowing('manage_routes', 'manage_settings'),
            true,
            'gym-a',
            '/gym-a/admin/settings',
            t,
            'staff',
        )
        expect(sections.map((section) => section.key)).toEqual([
            'manage',
            'admin',
        ])
        expect(sections[1]!.items.find((item) => item.current)?.testid).toBe(
            'nav-link-admin-settings',
        )
    })

    it('shows only the platform links on platform pages', () => {
        const { sections } = sidebarSections(
            allowing(PLATFORM_ADMIN, 'manage_routes'),
            true,
            'gym-a',
            '/platform/gyms/abc',
            t,
            'platform',
        )
        expect(
            sections.map((section) => section.items.map((i) => i.to)),
        ).toEqual([
            [
                '/platform',
                '/platform/moderation',
                '/platform/gyms',
                '/platform/users',
                '/platform/settings',
            ],
        ])
    })
})

describe('zoneOfPath', () => {
    it('places pages in gym, community or you', () => {
        expect(zoneOfPath('/gym-a')).toBe('gym')
        expect(zoneOfPath('/gym-a/map')).toBe('gym')
        expect(zoneOfPath('/gym-a/route')).toBe('gym')
        expect(zoneOfPath('/gym-a/competitions/abc')).toBe('community')
        expect(zoneOfPath('/friends')).toBe('community')
        expect(zoneOfPath('/climber')).toBe('community')
        expect(zoneOfPath('/logbook')).toBe('you')
        expect(zoneOfPath('/gym-a/manage/routes')).toBeNull()
        expect(zoneOfPath('/')).toBeNull()
        expect(gymLocalPath('/route')).toBeNull()
        expect(gymLocalPath('/gym-a/')).toBe('/')
    })
})

describe('sectionTabs', () => {
    it('offers the sibling pages of a zone', () => {
        expect(
            sectionTabs('/gym-a/map', 'gym-a').map((tab) => [
                tab.to,
                tab.active,
            ]),
        ).toEqual([
            ['/gym-a/routes', false],
            ['/gym-a/map', true],
            ['/gym-a/info', false],
            ['/gym-a', false],
        ])
        expect(sectionTabs('/gym-a/leaderboard', 'gym-a')[1]).toMatchObject({
            testid: 'section-tab-leaderboard',
            active: true,
        })
        expect(sectionTabs('/gym-a/route', 'gym-a')).toEqual([])
        expect(sectionTabs('/friends', 'gym-a').at(-1)).toMatchObject({
            to: '/friends',
            active: true,
        })
        expect(sectionTabs('/friends', '')).toEqual([])
    })

    it('leaves signed-in pages out for guests', () => {
        expect(
            sectionTabs('/gym-a/feed', 'gym-a', false).map((tab) => tab.to),
        ).toEqual(['/gym-a/feed', '/gym-a/leaderboard', '/gym-a/competitions'])
    })
})

describe('navContext', () => {
    it('tells gym, platform and tenant-less pages apart', () => {
        expect(navContext('/gym-a/routes', 'gym-a')).toBe('gym')
        expect(navContext('/gym-a/manage', 'gym-a')).toBe('staff')
        expect(navContext('/gym-a/admin/users', 'gym-a')).toBe('staff')
        expect(navContext('/platform', '')).toBe('platform')
        expect(navContext('/platform/gyms/abc', '')).toBe('platform')
        expect(navContext('/logbook', '')).toBe('global')
        expect(navContext('/platformer', '')).toBe('global')
    })
})

describe('requestedSection', () => {
    it('falls back to the first section', () => {
        expect(requestedSection('links', ['access', 'links'])).toBe('links')
        expect(requestedSection('nope', ['access', 'links'])).toBe('access')
        expect(requestedSection(['links'], ['access', 'links'])).toBe('access')
        expect(requestedSection(undefined, ['access'])).toBe('access')
    })
})

describe('bottomNavLinks', () => {
    const activeAt = (
        path: string,
        context: 'gym' | 'staff' | 'platform' | 'global' = 'gym',
    ) =>
        bottomNavLinks(path, 'gym-a', context).find((link) => link.active)?.path

    it('points the gym and community tabs at the given gym', () => {
        expect(
            bottomNavLinks('/logbook', 'gym-a', 'global').map(
                (link) => link.to,
            ),
        ).toEqual([
            '/gym-a/routes',
            '/gym-a/feed',
            '/scan',
            '/logbook',
            '/account',
        ])
        expect(bottomNavLinks('/logbook', '', 'global')[1]!.to).toBe('/')
    })

    it('marks the zone of the current page', () => {
        expect(activeAt('/gym-a/map')).toBe('/routes')
        expect(activeAt('/gym-a')).toBe('/routes')
        expect(activeAt('/gym-a/leaderboard')).toBe('/feed')
        expect(activeAt('/friends', 'global')).toBe('/feed')
        expect(activeAt('/logbook', 'global')).toBe('/logbook')
        expect(activeAt('/account', 'global')).toBe('/account')
        expect(activeAt('/account/settings', 'global')).toBeUndefined()
    })

    it('swaps to permitted staff tabs in the staff workspace', () => {
        const tabs = bottomNavLinks(
            '/gym-a/manage/tasks',
            'gym-a',
            'staff',
            (permission) => permission === 'manage_tasks',
        )
        expect(tabs.map((tab) => tab.to)).toEqual([
            '/gym-a/manage/tasks',
            '/gym-a/manage',
        ])
        expect(tabs.find((tab) => tab.active)?.path).toBe('/manage/tasks')
        expect(activeAt('/gym-a/manage', 'staff')).toBe('/manage')
    })

    it('marks More on staff pages without their own tab', () => {
        expect(activeAt('/gym-a/manage/walls', 'staff')).toBe('/manage')
        expect(activeAt('/gym-a/admin/users', 'staff')).toBe('/manage')
        expect(activeAt('/gym-a/manage/routes/new', 'staff')).toBe(
            '/manage/routes',
        )
        expect(
            bottomNavLinks(
                '/gym-a/manage/routes',
                'gym-a',
                'staff',
                () => false,
            ).find((tab) => tab.active)?.path,
        ).toBe('/manage')
    })

    it('swaps to the platform links on platform pages', () => {
        expect(
            bottomNavLinks('/platform/gyms/abc', 'gym-a', 'platform').map(
                (link) => link.to,
            ),
        ).toEqual([
            '/platform',
            '/platform/moderation',
            '/platform/gyms',
            '/platform/users',
            '/account',
        ])
        expect(activeAt('/platform', 'platform')).toBe('/platform')
        expect(activeAt('/platform/gyms/abc', 'platform')).toBe(
            '/platform/gyms',
        )
    })
})
