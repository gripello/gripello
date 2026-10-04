import { describe, expect, it } from 'vitest'
import {
    PLATFORM_ADMIN,
    gymLink,
    pageLinks,
    sidebarItems,
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
        expect(items.map((item) => item.key)).toEqual([
            'home',
            'list',
            'map',
            'logbook',
            'competitions',
        ])
        expect(items.map((item) => item.to)).toEqual([
            '/gym-a',
            '/gym-a/routes',
            '/gym-a/map',
            '/logbook',
            '/gym-a/competitions',
        ])
    })

    it('shows guests only the public pages', () => {
        const keys = visibleNavItems(allowing(), false, 'gym-a').map(
            (item) => item.key,
        )
        expect(keys).toEqual(['home', 'list', 'map', 'competitions'])
    })

    it('keeps only the landing page and logbook outside a gym', () => {
        const keys = visibleNavItems(allowing('manage_routes'), true).map(
            (item) => item.key,
        )
        expect(keys).toEqual(['home', 'logbook'])
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
            ['moderation', ['/manage/comments', '/manage/reports']],
        ])
    })

    it('returns nothing for climbers or without a gym', () => {
        expect(staffSections(allowing(), 'gym-a')).toEqual([])
        expect(staffSections(allowing('manage_routes'))).toEqual([])
    })
})

describe('pageLinks', () => {
    it('lists public pages that are not in the bottom nav', () => {
        expect(pageLinks(false, 'gym-a').map((link) => link.to)).toEqual([
            '/gym-a',
            '/gym-a/routes',
            '/gym-a/competitions',
        ])
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
        expect(
            sidebarItems(
                allowing(PLATFORM_ADMIN),
                true,
                'gym-a',
                '/gym-a/routes',
                (key) => key,
            )[1],
        ).toEqual([])
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

describe('sidebarItems', () => {
    const t = (key: string) => `t:${key}`

    it('lists pages flat and staff sections as collapsible groups', () => {
        const [pages, groups] = sidebarItems(
            allowing('manage_routes', 'manage_settings'),
            true,
            'gym-a',
            '/gym-a/admin/settings',
            t,
        )
        expect(pages!.map((item) => item.testid)).toEqual([
            'nav-link-home',
            'nav-link-routes',
            'nav-link-map',
            'nav-link-logbook',
            'nav-link-competitions',
        ])
        expect(groups).toEqual([
            expect.objectContaining({
                label: 't:nav.manage',
                'aria-label': 't:nav.manage',
                icon: 'i-lucide-sliders-horizontal',
                testid: 'nav-group-manage',
                current: false,
                defaultOpen: false,
            }),
            expect.objectContaining({
                testid: 'nav-group-admin',
                current: true,
                defaultOpen: true,
                children: [
                    expect.objectContaining({
                        to: '/gym-a/admin/map',
                        testid: 'nav-link-admin-map',
                    }),
                    expect.objectContaining({
                        to: '/gym-a/admin/settings',
                        testid: 'nav-link-admin-settings',
                    }),
                ],
            }),
        ])
    })

    it('matches whole path segments', () => {
        const groupsAt = (path: string) =>
            sidebarItems(allowing('manage_users'), true, 'gym-a', path, t)[1]!
        expect(groupsAt('/gym-a/admin')).toEqual([
            expect.objectContaining({ defaultOpen: false }),
        ])
        expect(groupsAt('/gym-a/admin/users')).toEqual([
            expect.objectContaining({ defaultOpen: true }),
        ])
    })

    it('shows only the platform links on platform pages', () => {
        const lists = sidebarItems(
            allowing(PLATFORM_ADMIN, 'manage_routes'),
            true,
            'gym-a',
            '/platform/gyms/abc',
            t,
        )
        expect(lists).toEqual([
            [
                expect.objectContaining({
                    to: '/platform',
                    testid: 'nav-link-platform',
                }),
                expect.objectContaining({
                    to: '/platform/gyms',
                    testid: 'nav-link-platform-gyms',
                }),
                expect.objectContaining({
                    to: '/platform/users',
                    testid: 'nav-link-platform-users',
                }),
                expect.objectContaining({
                    to: '/platform/settings',
                    label: 't:platform.settings.title',
                }),
            ],
        ])
    })
})

describe('navContext', () => {
    it('tells gym, platform and tenant-less pages apart', () => {
        expect(navContext('/gym-a/routes', 'gym-a')).toBe('gym')
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
    const activeAt = (path: string, slug = 'gym-a') =>
        bottomNavLinks(path, slug).find((link) => link.active)?.path

    it('points the map at the given gym', () => {
        expect(bottomNavLinks('/logbook', 'gym-a')[0]!.to).toBe('/gym-a/map')
        expect(bottomNavLinks('/logbook', '')[0]!.to).toBe('/')
    })

    it('marks the current climber page', () => {
        expect(activeAt('/gym-a/map')).toBe('/map')
        expect(activeAt('/gym-a/manage/map')).toBeUndefined()
        expect(activeAt('/logbook')).toBe('/logbook')
        expect(activeAt('/account')).toBe('/account')
        expect(activeAt('/account/settings')).toBeUndefined()
    })

    it('swaps to the platform links on platform pages', () => {
        expect(
            bottomNavLinks('/platform/gyms/abc', 'gym-a').map(
                (link) => link.to,
            ),
        ).toEqual([
            '/platform',
            '/platform/gyms',
            '/platform/users',
            '/platform/settings',
            '/account',
        ])
        expect(activeAt('/platform')).toBe('/platform')
        expect(activeAt('/platform/gyms/abc')).toBe('/platform/gyms')
    })
})
