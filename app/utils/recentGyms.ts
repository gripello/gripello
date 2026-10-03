export const RECENT_GYMS_KEY = 'gripello-recent-gyms'
const MAX_RECENT_GYMS = 5

export function withRecentGym(recent: string[], slug: string) {
    return [slug, ...recent.filter((entry) => entry !== slug)].slice(
        0,
        MAX_RECENT_GYMS,
    )
}

export function parseRecentGyms(raw: string | null): string[] {
    try {
        const parsed = JSON.parse(raw ?? '[]')
        return Array.isArray(parsed)
            ? parsed.filter((entry) => typeof entry === 'string')
            : []
    } catch {
        return []
    }
}

export function readRecentGyms(): string[] {
    try {
        return parseRecentGyms(localStorage.getItem(RECENT_GYMS_KEY))
    } catch {
        return []
    }
}

export function rememberRecentGym(slug: string) {
    try {
        localStorage.setItem(
            RECENT_GYMS_KEY,
            JSON.stringify(withRecentGym(readRecentGyms(), slug)),
        )
    } catch {}
}
