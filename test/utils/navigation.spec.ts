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

    it('links platform admins to the unprefixed platform pages, with or without a gym', () => {
        for (const slug of ['gym-a', '']) {
            const platform = staffSections(allowing(PLATFORM_ADMIN), slug)
            expect(platform).toEqual([
                expect.objectContaining({
                    key: 'platform',
                    links: [
                        expect.objectContaining({ to: '/platform' }),
                        expect.objectContaining({ to: '/platform/gyms' }),
                        expect.objectContaining({ to: '/platform/settings' }),
                    ],
                }),
            ])
        }
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
            sidebarItems(allowing(PLATFORM_ADMIN), true, '', path, t)[1]!
        expect(groupsAt('/platform/gyms/abc')[0]!.defaultOpen).toBe(true)
        expect(groupsAt('/platformer')).toEqual([
            expect.objectContaining({ defaultOpen: false }),
        ])
    })
})
