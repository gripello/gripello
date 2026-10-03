import { navTestId } from '~/utils/nav'

export interface NavLink {
    to: string
    path?: string
    icon: string
    label: string
    permission?: string
}

export interface NavItem extends Partial<NavLink> {
    key: string
    signedIn?: boolean
    icon: string
    label: string
    children?: NavLink[]
}

type Can = (permission: string) => boolean

export const PLATFORM_ADMIN = 'platform_admin'
export const PLATFORM_ADMIN_GRANTS = ['manage_settings', 'manage_users']

export const BOTTOM_NAV: NavLink[] = [
    { to: '/map', icon: 'i-lucide-map', label: 'routes.map' },
    { to: '/scan', icon: 'i-lucide-scan-qr-code', label: 'routes.scan' },
    {
        to: '/logbook',
        icon: 'i-lucide-book-check',
        label: 'routes.logbook',
    },
    { to: '/account', icon: 'i-lucide-layout-grid', label: 'routes.me' },
]

export const NAV_ITEMS: NavItem[] = [
    {
        key: 'home',
        to: '/',
        icon: 'i-lucide-house',
        label: 'routes.home',
    },
    {
        key: 'list',
        to: '/routes',
        icon: 'i-lucide-list',
        label: 'routes.list',
    },
    {
        key: 'map',
        to: '/map',
        icon: 'i-lucide-map',
        label: 'routes.map',
    },
    {
        key: 'logbook',
        signedIn: true,
        to: '/logbook',
        icon: 'i-lucide-book-check',
        label: 'routes.logbook',
    },
    {
        key: 'competitions',
        to: '/competitions',
        icon: 'i-lucide-trophy',
        label: 'routes.competitions',
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
                label: 'routes.mapPlacement',
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
                to: '/manage/comments',
                icon: 'i-lucide-message-square',
                label: 'routes.comments',
                permission: 'manage_comments',
            },
            {
                to: '/manage/reports',
                icon: 'i-lucide-flag',
                label: 'routes.reports',
                permission: 'manage_reports',
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
    {
        key: 'platform',
        icon: 'i-lucide-building-2',
        label: 'nav.platform',
        children: [
            {
                to: '/platform',
                icon: 'i-lucide-layout-dashboard',
                label: 'platform.overview.title',
                permission: PLATFORM_ADMIN,
            },
            {
                to: '/platform/gyms',
                icon: 'i-lucide-building-2',
                label: 'platform.gyms.title',
                permission: PLATFORM_ADMIN,
            },
            {
                to: '/platform/settings',
                icon: 'i-lucide-sliders-horizontal',
                label: 'platform.settings.title',
                permission: PLATFORM_ADMIN,
            },
        ],
    },
]

const GYMLESS_PATHS = ['/logbook', '/account', '/scan', '/platform']

const isGymless = (to: string) =>
    GYMLESS_PATHS.some((path) => to === path || to.startsWith(`${path}/`))

export function gymLink(to: string, slug: string) {
    if (isGymless(to) || !slug) return to
    return to === '/' ? `/${slug}` : `/${slug}${to}`
}

export function withGymSlug(fullPath: string, slug: string) {
    return fullPath.replace(/^\/[^/?#]+/, `/${slug}`)
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

const allowed = (can: Can) => (link: { permission?: string }) =>
    !link.permission || can(link.permission)

export function visibleNavItems(
    can: Can,
    signedIn = true,
    slug = '',
): NavItem[] {
    return withGym(NAV_ITEMS, slug)
        .filter((item) => signedIn || !item.signedIn)
        .map((item) =>
            item.children
                ? { ...item, children: item.children.filter(allowed(can)) }
                : item,
        )
        .filter((item) =>
            item.children ? item.children.length > 0 : allowed(can)(item),
        )
}

export function staffSections(
    can: Can,
    slug = '',
): { key: string; label: string; icon: string; links: NavLink[] }[] {
    return withGym(NAV_ITEMS, slug)
        .filter((item) => item.children)
        .map((group) => ({
            key: group.key,
            label: group.label,
            icon: group.icon,
            links: group.children!.filter(allowed(can)),
        }))
        .filter((section) => section.links.length > 0)
}

export interface SidebarItem {
    label: string
    icon: string
    to?: string
    testid: string
    current?: boolean
    defaultOpen?: boolean
    children?: SidebarItem[]
}

const isWithin = (path: string, to: string) =>
    path === to || path.startsWith(`${to}/`)

export function sidebarItems(
    can: Can,
    signedIn: boolean,
    slug: string,
    currentPath: string,
    t: (key: string) => string,
): SidebarItem[][] {
    const toItem = (link: NavLink): SidebarItem => ({
        label: t(link.label),
        icon: link.icon,
        to: link.to,
        testid: `nav-link-${navTestId(link.path ?? link.to)}`,
    })
    const pages = visibleNavItems(can, signedIn, slug)
        .filter((item) => !item.children && !item.permission)
        .map((item) => toItem(item as NavLink))
    const groups = staffSections(can, slug).map((section) => {
        const current = section.links.some((link) =>
            isWithin(currentPath, link.to),
        )
        return {
            label: t(section.label),
            icon: section.icon,
            testid: `nav-group-${section.key}`,
            current,
            defaultOpen: current,
            children: section.links.map(toItem),
        }
    })
    return [pages, groups]
}

export function pageLinks(signedIn: boolean, slug = ''): NavLink[] {
    const inBottomNav = new Set(BOTTOM_NAV.map((link) => link.to))
    return withGym(
        NAV_ITEMS.filter(
            (item) =>
                item.to &&
                !item.children &&
                !item.permission &&
                (signedIn || !item.signedIn) &&
                !inBottomNav.has(item.to),
        ),
        slug,
    ) as NavLink[]
}
