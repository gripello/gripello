const DAY_MS = 24 * 60 * 60 * 1000

export function tokenPayload(token: string): Record<string, unknown> {
    try {
        const part = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')
        const bytes = Uint8Array.from(atob(part), (char) => char.charCodeAt(0))
        return JSON.parse(new TextDecoder().decode(bytes)) || {}
    } catch {
        return {}
    }
}

export function tokenExpired(token: string, now = Date.now()): boolean {
    const payload = tokenPayload(token)
    if (!Object.keys(payload).length) return true
    return !!payload.exp && Number(payload.exp) * 1000 <= now
}

// Tokens last 7 days by default, so this refreshes at most once a day per device.
export function sessionNeedsRefresh(token: string, now = Date.now()): boolean {
    const expires = Number(tokenPayload(token).exp) * 1000
    return !Number.isFinite(expires) || expires - now < 6 * DAY_MS
}

export function currentSessionId(token: string): string {
    return token ? String(tokenPayload(token).sid ?? '') : ''
}
