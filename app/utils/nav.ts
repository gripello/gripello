import { activeMemberships } from '#shared/utils/memberships'

export function navTestId(to: string): string {
    return to.replace(/^\//, '').replaceAll('/', '-') || 'home'
}

export function safeRedirect(target: unknown): string | null {
    if (typeof target !== 'string') return null
    if (!target.startsWith('/') || /^\/[/\\]/.test(target)) return null
    return target
}

export function loginRedirect(redirect: unknown, hash: string) {
    const target = safeRedirect(redirect)
    return target && hash && !target.includes('#') ? target + hash : target
}

export function staffLandingPath(
    memberships: readonly { gym: { slug: string; active: boolean } }[],
): string {
    const slug = activeMemberships(memberships)[0]?.gym.slug
    return slug ? `/${slug}/manage/routes` : '/'
}
