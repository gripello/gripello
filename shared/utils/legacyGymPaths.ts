const LEGACY_PATH = /^\/(routes|map|manage|admin|competitions)(\/|$)/
const MOVED_ADMIN_PAGE =
    /^\/admin\/(routes|inventory|comments|reports|analytics)$/

export function isLegacyGymPath(path: string) {
    return path === '/admin/activity' || LEGACY_PATH.test(path)
}

export function legacyGymRedirect(
    path: string,
    search: string,
    slug: string,
): string | null {
    if (path === '/admin/activity') return '/account/activity'
    if (!isLegacyGymPath(path)) return null
    if (!slug) return '/'
    const moved = MOVED_ADMIN_PAGE.exec(path)
    return `/${slug}${moved ? `/manage/${moved[1]}` : path}${search}`
}
