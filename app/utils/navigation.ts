import {
    MODERATION_PERMISSIONS,
    PLATFORM_ADMIN,
    meetsRequirement,
    type Permission,
    type PermissionCheck,
    type PermissionRequirement,
} from '#shared/utils/permissions'
import { navTestId } from '~/utils/nav'

export interface NavLink {
    to: string
    path?: string
    icon: string
    label: string
    permission?: PermissionRequirement
    signedIn?: boolean
    badge?: NavBadge
}

export type NavBadge = 'moderation'
export type NavBadges = Partial<Record<NavBadge, number>>

export type Zone = 'gym' | 'community' | 'you'

export interface NavItem extends Partial<NavLink> {
    key: string
    zone?: Zone
    signedIn?: boolean
    icon: string
    label: string
    children?: NavLink[]
}

type Can = (permission: PermissionCheck) => boolean

export const PLATFORM_ADMIN_GRANTS: readonly Permission[] = [
    'manage_settings',
    'manage_users',
]

const YOU_TAB: NavLink = {
    to: '/account',
    icon: 'i-lucide-circle-user-round',
    label: 'nav.you',
}
const SCAN_TAB: NavLink = {
    to: '/scan',
    icon: 'i-lucide-scan-qr-code',
    label: 'routes.scan',
}

export const CLIMBER_TABS: NavLink[] = [
    { to: '/routes', icon: 'i-lucide-mountain', label: 'nav.gym' },
    { to: '/feed', icon: 'i-lucide-users', label: 'nav.community' },
    SCAN_TAB,
    { to: '/logbook', icon: 'i-lucide-book-check', label: 'routes.logbook' },
    YOU_TAB,
]

export const STAFF_TABS: NavLink[] = [
    {
        to: '/manage/routes',
        icon: 'i-lucide-waypoints',
        label: 'routes.list',
        permission: 'manage_routes',
    },
    {
        to: '/manage/tasks',
        icon: 'i-lucide-list-checks',
        label: 'routes.tasks',
        permission: 'manage_tasks',
    },
    {
        to: '/manage/moderation',
        icon: 'i-lucide-shield-check',
        label: 'moderation.title',
        permission: MODERATION_PERMISSIONS,
        badge: 'moderation',
    },
    { to: '/manage', icon: 'i-lucide-ellipsis', label: 'nav.more' },
]

export const PLATFORM_LINKS: NavLink[] = [
    {
        to: '/platform',
        icon: 'i-lucide-layout-dashboard',
        label: 'platform.overview.title',
        permission: PLATFORM_ADMIN,
    },
    {
        to: '/platform/moderation',
        icon: 'i-lucide-shield-alert',
        label: 'moderation.title',
        permission: PLATFORM_ADMIN,
        badge: 'moderation',
    },
    {
        to: '/platform/gyms',
        icon: 'i-lucide-building-2',
        label: 'platform.gyms.title',
        permission: PLATFORM_ADMIN,
    },
    {
        to: '/platform/users',
        icon: 'i-lucide-users-round',
        label: 'platform.users.title',
        permission: PLATFORM_ADMIN,
    },
    {
        to: '/platform/audit',
        icon: 'i-lucide-clipboard-clock',
        label: 'audit.title',
        permission: PLATFORM_ADMIN,
    },
    {
        to: '/platform/backups',
        icon: 'i-lucide-archive',
        label: 'platform.backups.title',
        permission: PLATFORM_ADMIN,
    },
    {
        to: '/platform/logs',
        icon: 'i-lucide-scroll-text',
        label: 'platform.logs.title',
        permission: PLATFORM_ADMIN,
    },
    {
        to: '/platform/settings',
        icon: 'i-lucide-sliders-horizontal',
        label: 'platform.settings.title',
        permission: PLATFORM_ADMIN,
    },
]

export const PLATFORM_MORE = '/platform/more'

export const PLATFORM_BOTTOM_NAV: NavLink[] = [
    PLATFORM_LINKS[0]!,
    PLATFORM_LINKS[1]!,
    ...PLATFORM_LINKS.slice(2, 4),
    { to: PLATFORM_MORE, icon: 'i-lucide-menu', label: 'nav.more' },
]

export const PLATFORM_MORE_LINKS = PLATFORM_LINKS.slice(4)

export const NAV_ITEMS: NavItem[] = [
    {
        key: 'home',
        zone: 'gym',
        to: '/',
        icon: 'i-lucide-house',
        label: 'routes.home',
    },
    {
        key: 'list',
        zone: 'gym',
        to: '/routes',
        icon: 'i-lucide-list',
        label: 'routes.list',
    },
    {
        key: 'map',
        zone: 'gym',
        to: '/map',
        icon: 'i-lucide-map',
        label: 'routes.map',
    },
    {
        key: 'info',
        zone: 'gym',
        to: '/info',
        icon: 'i-lucide-info',
        label: 'routes.info',
    },
    {
        key: 'feed',
        zone: 'community',
        to: '/feed',
        icon: 'i-lucide-newspaper',
        label: 'routes.feed',
    },
    {
        key: 'leaderboard',
        zone: 'community',
        to: '/leaderboard',
        icon: 'i-lucide-medal',
        label: 'routes.leaderboard',
    },
    {
        key: 'competitions',
        zone: 'community',
        to: '/competitions',
        icon: 'i-lucide-trophy',
        label: 'routes.competitions',
    },
    {
        key: 'friends',
        zone: 'community',
        signedIn: true,
        to: '/friends',
        icon: 'i-lucide-users',
        label: 'routes.friends',
    },
    {
        key: 'logbook',
        zone: 'you',
        signedIn: true,
        to: '/logbook',
        icon: 'i-lucide-book-check',
        label: 'routes.logbook',
    },
    {
        key: 'manage',
        icon: 'i-lucide-sliders-horizontal',
        label: 'nav.manage',
        children: [
            {
                to: '/manage/routes',
                icon: 'i-lucide-waypoints',
                label: 'routes.dashboard',
                permission: 'manage_routes',
            },
            {
                to: '/manage/map',
                icon: 'i-lucide-map-pinned',
                label: 'routes.mapWork',
                permission: 'manage_routes',
            },
            {
                to: '/manage/inventory',
                icon: 'i-lucide-package',
                label: 'routes.inventory',
                permission: 'run_inventory',
            },
            {
                to: '/manage/tasks',
                icon: 'i-lucide-list-checks',
                label: 'routes.tasks',
                permission: 'manage_tasks',
            },
            {
                to: '/manage/competitions',
                icon: 'i-lucide-trophy',
                label: 'routes.competitions',
                permission: 'manage_competitions',
            },
            {
                to: '/manage/judge',
                icon: 'i-lucide-clipboard-pen',
                label: 'routes.judge',
                permission: 'judge_competitions',
            },
            {
                to: '/manage/analytics',
                icon: 'i-lucide-chart-line',
                label: 'routes.analytics',
                permission: 'view_analytics',
            },
        ],
    },
    {
        key: 'moderation',
        icon: 'i-lucide-shield-check',
        label: 'nav.moderation',
        children: [
            {
                to: '/manage/moderation',
                icon: 'i-lucide-shield-check',
                label: 'moderation.title',
                permission: MODERATION_PERMISSIONS,
                badge: 'moderation',
            },
            {
                to: '/manage/comments',
                icon: 'i-lucide-message-square',
                label: 'routes.comments',
                permission: 'manage_comments',
            },
        ],
    },
    {
        key: 'admin',
        icon: 'i-lucide-shield-user',
        label: 'nav.admin',
        children: [
            {
                to: '/admin/users',
                icon: 'i-lucide-users-round',
                label: 'routes.users',
                permission: 'manage_users',
            },
            {
                to: '/admin/map',
                icon: 'i-lucide-land-plot',
                label: 'routes.mapEditor',
                permission: 'manage_settings',
            },
            {
                to: '/admin/settings',
                icon: 'i-lucide-settings',
                label: 'routes.settings',
                permission: 'manage_settings',
            },
        ],
    },
]

const PLATFORM_GROUP: NavItem = {
    key: 'platform',
    icon: 'i-lucide-building-2',
    label: 'nav.platform',
    children: PLATFORM_LINKS,
}

const GYMLESS_PATHS = [
    '/logbook',
    '/friends',
    '/climber',
    '/account',
    '/scan',
    '/platform',
]

const isGymless = (to: string) =>
    GYMLESS_PATHS.some((path) => to === path || to.startsWith(`${path}/`))

export function gymLink(to: string, slug: string) {
    if (isGymless(to) || !slug) return to
    return to === '/' ? `/${slug}` : `/${slug}${to}`
}

export function withGymSlug(fullPath: string, slug: string) {
    return fullPath.replace(/^\/[^/?#]+/, `/${slug}`)
}

export function gymSwitchPath(
    path: string,
    slug: string,
    opensRecord: boolean,
) {
    const rest = path.split('/').slice(2).filter(Boolean)
    if (!opensRecord) return `/${[slug, ...rest].join('/')}`
    const section = rest.slice(
        0,
        ['manage', 'admin'].includes(rest[0]!) ? 2 : 1,
    )
    if (section[0] === 'route') section[0] = 'routes'
    return `/${[slug, ...section].join('/')}`
}

export function withGym<T extends { to?: string; children?: NavLink[] }>(
    items: T[],
    slug: string,
): T[] {
    const available = (to: string) => !!slug || to === '/' || isGymless(to)
    return items
        .filter((item) => !item.to || available(item.to))
        .map((item) => ({
            ...item,
            ...(item.to && { to: gymLink(item.to, slug), path: item.to }),
            ...(item.children && {
                children: withGym(item.children, slug),
            }),
        }))
}

const allowed = (can: Can) => (link: { permission?: PermissionRequirement }) =>
    !link.permission || meetsRequirement(link.permission, can)

const forViewer = (signedIn: boolean) => (link: { signedIn?: boolean }) =>
    signedIn || !link.signedIn

export function visibleNavItems(
    can: Can,
    signedIn = true,
    slug = '',
): NavItem[] {
    return withGym([...NAV_ITEMS, PLATFORM_GROUP], slug)
        .filter(forViewer(signedIn))
        .map((item) =>
            item.children
                ? {
                      ...item,
                      children: item.children
                          .filter(allowed(can))
                          .filter(forViewer(signedIn)),
                  }
                : item,
        )
        .filter((item) =>
            item.children ? item.children.length > 0 : allowed(can)(item),
        )
}

function navSections(can: Can, signedIn: boolean, slug: string) {
    return visibleNavItems(can, signedIn, slug)
        .filter((item) => item.key !== PLATFORM_GROUP.key && item.children)
        .map((group) => ({
            key: group.key,
            label: group.label,
            icon: group.icon,
            links: group.children!,
        }))
}

export function staffSections(
    can: Can,
    slug = '',
): { key: string; label: string; icon: string; links: NavLink[] }[] {
    return navSections(can, true, slug).filter((section) =>
        section.links.every((link) => link.permission),
    )
}

export interface SidebarItem {
    label: string
    icon: string
    to?: string
    testid: string
    current?: boolean
    active?: boolean
    badge?: string
    defaultOpen?: boolean
    'aria-label'?: string
    children?: SidebarItem[]
}

export interface SidebarSection {
    key: string
    label: string
    items: SidebarItem[]
}

const isWithin = (path: string, to: string) =>
    path === to || path.startsWith(`${to}/`)

export type NavContext = 'gym' | 'staff' | 'platform' | 'global'

export function navContext(path: string, routeSlug: string): NavContext {
    if (isWithin(path, '/platform')) return 'platform'
    if (!routeSlug) return 'global'
    return /^\/[^/]+\/(manage|admin)(\/|$)/.test(path) ? 'staff' : 'gym'
}

export function staffExitPath(returnTo: string | null, slug: string) {
    const path = returnTo?.split(/[?#]/)[0]
    if (!path || navContext(path, slug) === 'staff') return `/${slug}/routes`
    return gymLocalPath(path) === null || isWithin(path, `/${slug}`)
        ? returnTo!
        : `/${slug}/routes`
}

export function requestedSection(requested: unknown, ids: string[]) {
    return typeof requested === 'string' && ids.includes(requested)
        ? requested
        : ids[0]!
}

const GLOBAL_PAGES = ['/route', '/auth', '/imprint', '/privacy']

export function gymLocalPath(path: string): string | null {
    const [, first = '', ...rest] = path.split('/')
    const top = `/${first}`
    if (!first || isGymless(top) || GLOBAL_PAGES.includes(top)) return null
    return `/${rest.join('/')}`.replace(/\/$/, '') || '/'
}

const GYM_PAGES = ['/', '/routes', '/map', '/info', '/route']
const COMMUNITY_PAGES = ['/feed', '/leaderboard', '/competitions']

export function zoneOfPath(path: string): Zone | null {
    if (isWithin(path, '/friends') || isWithin(path, '/climber'))
        return 'community'
    if (isWithin(path, '/logbook')) return 'you'
    const local = gymLocalPath(path)
    if (!local) return null
    if (GYM_PAGES.includes(local)) return 'gym'
    if (COMMUNITY_PAGES.some((page) => isWithin(local, page)))
        return 'community'
    return null
}

const TAB_ZONES: Record<string, Zone> = {
    '/routes': 'gym',
    '/feed': 'community',
}

export function bottomNavLinks(
    path: string,
    gymSlug: string,
    context: NavContext,
    can: Can = () => true,
) {
    if (context === 'platform') {
        const tabPath = PLATFORM_MORE_LINKS.some((link) =>
            isWithin(path, link.to),
        )
            ? PLATFORM_MORE
            : path
        return PLATFORM_BOTTOM_NAV.map((link) => ({
            ...link,
            path: link.to,
            active:
                link.to ===
                PLATFORM_BOTTOM_NAV.map((tab) => tab.to)
                    .filter((to) => isWithin(tabPath, to))
                    .sort((a, b) => b.length - a.length)[0],
        }))
    }
    if (context === 'staff') {
        const local = gymLocalPath(path) ?? ''
        const tabs = STAFF_TABS.filter(allowed(can))
        const activeTo =
            tabs
                .map((tab) => tab.to)
                .filter((to) => to !== '/manage' && isWithin(local, to))
                .sort((a, b) => b.length - a.length)[0] ?? '/manage'
        return tabs.map((link) => ({
            ...link,
            to: gymLink(link.to, gymSlug),
            path: link.to,
            active: link.to === activeTo,
        }))
    }
    const zone = zoneOfPath(path)
    return CLIMBER_TABS.map((link) => ({
        ...link,
        to: TAB_ZONES[link.to]
            ? gymSlug
                ? `/${gymSlug}${link.to}`
                : '/'
            : link.to,
        path: link.to,
        active: TAB_ZONES[link.to]
            ? TAB_ZONES[link.to] === zone
            : link.to === '/account'
              ? path === link.to
              : isWithin(path, link.to),
    }))
}

const SECTION_TABS: Record<Zone, string[]> = {
    gym: ['/', '/routes', '/map', '/info'],
    community: ['/feed', '/leaderboard', '/competitions', '/friends'],
    you: [],
}

export function offlineTabPaths(gymSlug: string) {
    const gymPaths = gymSlug
        ? [...SECTION_TABS.gym, '/route'].map((to) =>
              to === '/' ? `/${gymSlug}` : `/${gymSlug}${to}`,
          )
        : []
    const tabs = bottomNavLinks('/', gymSlug, 'gym').map((link) => link.to)
    return [...new Set([...tabs, ...gymPaths])].filter(Boolean) as string[]
}

export function sectionTabs(path: string, slug: string, signedIn = true) {
    const local = path === '/friends' ? path : gymLocalPath(path)
    const zone = zoneOfPath(path)
    if (!slug || !local || !zone || !SECTION_TABS[zone].includes(local))
        return []
    return SECTION_TABS[zone]
        .map((to) => NAV_ITEMS.find((entry) => entry.to === to)!)
        .filter(forViewer(signedIn))
        .map((item) => ({
            to: gymLink(item.to!, slug),
            label: item.label,
            icon: item.icon,
            testid: `section-tab-${navTestId(item.to!)}`,
            active: item.to === local,
        }))
}

const isPage = (item: NavItem) => !item.children && !item.permission

const hasQueryOf = (query: URLSearchParams, to: string) =>
    [...new URLSearchParams(to.split('?')[1])].every(
        ([key, value]) => query.get(key) === value,
    )

function staffLinkCurrent(currentPath: string, to: string, links: NavLink[]) {
    const [path = '', search = ''] = currentPath.split('?')
    const query = new URLSearchParams(search)
    const [toPath = ''] = to.split('?')
    if (to.includes('?')) return path === toPath && hasQueryOf(query, to)
    return (
        isWithin(path, toPath) &&
        !links.some(
            (other) =>
                other.to.startsWith(`${to}?`) && hasQueryOf(query, other.to),
        )
    )
}

function ownProfileState(currentPath: string, myId: string) {
    const current = staffLinkCurrent(currentPath, `/climber?id=${myId}`, [])
    return { current, active: current }
}

export function sidebarSections(
    can: Can,
    signedIn: boolean,
    slug: string,
    currentPath: string,
    t: (key: string) => string,
    context: NavContext,
    myId = '',
    badges: NavBadges = {},
): { sections: SidebarSection[]; staffEntry: string | null } {
    const toItem = (link: NavLink): SidebarItem => ({
        label: t(link.label),
        'aria-label': t(link.label),
        icon: link.icon,
        to: link.to,
        testid: `nav-link-${navTestId(link.path ?? link.to)}`,
        ...(link.badge && badges[link.badge]
            ? { badge: String(badges[link.badge]) }
            : {}),
    })
    if (context === 'platform')
        return {
            sections: [
                {
                    key: 'platform',
                    label: t('nav.platform'),
                    items: PLATFORM_LINKS.filter(allowed(can)).map(toItem),
                },
            ],
            staffEntry: null,
        }
    const staff = staffSections(can, slug)
    if (context === 'staff')
        return {
            sections: staff.map((section) => ({
                key: section.key,
                label: t(section.label),
                items: section.links.map((link) => {
                    const current = staffLinkCurrent(
                        currentPath,
                        link.to,
                        section.links,
                    )
                    return { ...toItem(link), current, active: current }
                }),
            })),
            staffEntry: null,
        }
    const pages = visibleNavItems(can, signedIn, slug).filter(isPage)
    const zone = (key: Zone) =>
        pages
            .filter((item) => item.zone === key)
            .map((item) => toItem(item as NavLink))
    const you = [
        ...zone('you'),
        ...(signedIn && myId
            ? [
                  {
                      label: t('friends.myProfile'),
                      icon: 'i-lucide-id-card',
                      to: `/climber?id=${myId}`,
                      testid: 'nav-link-climber',
                      ...ownProfileState(currentPath, myId),
                  },
              ]
            : []),
    ]
    return {
        sections: [
            { key: 'gym', label: t('nav.gym'), items: zone('gym') },
            {
                key: 'community',
                label: t('nav.community'),
                items: zone('community'),
            },
            { key: 'you', label: t('nav.you'), items: you },
        ].filter((section) => section.items.length > 0),
        staffEntry: slug && staff.length ? `/${slug}/manage` : null,
    }
}

const ROOT_PAGES = [
    '/logbook',
    '/scan',
    '/account',
    '/friends',
    '/platform/more',
]

export function parentPath(path: string): string | null {
    const clean = path.replace(/\/$/, '') || '/'
    if (clean === '/' || ROOT_PAGES.includes(clean)) return null
    if (isWithin(clean, '/auth')) return null
    if (PLATFORM_BOTTOM_NAV.some((link) => link.to === clean)) return null
    if (PLATFORM_MORE_LINKS.some((link) => isWithin(clean, link.to)))
        return PLATFORM_MORE
    if (isWithin(clean, '/climber')) return '/friends'
    if (['/route', '/imprint', '/privacy'].includes(clean)) return '/'
    const local = gymLocalPath(clean)
    if (local === null) return clean.replace(/\/[^/]+$/, '') || '/'
    const slug = clean.split('/')[1]!
    const zone = zoneOfPath(clean)
    const staffRoots = STAFF_TABS.map((tab) => tab.to)
    if (zone && SECTION_TABS[zone].includes(local)) return null
    if (staffRoots.includes(local)) return null
    if (local === '/route') return gymLink('/routes', slug)
    if (/^\/(manage|admin)\/[^/]+$/.test(local)) return gymLink('/manage', slug)
    return gymLink(local.replace(/\/[^/]+$/, '') || '/', slug)
}

export type NavDirection = 'push' | 'pop' | null

export function navDirection(
    fromPosition: number | undefined,
    toPosition: number | undefined,
    fromPath: string,
    toPath: string,
): NavDirection {
    if (fromPosition === undefined || toPosition === undefined) return null
    if (toPosition < fromPosition) return parentPath(fromPath) ? 'pop' : null
    return parentPath(toPath) ? 'push' : null
}
