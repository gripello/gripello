import type PocketBase from 'pocketbase'
import { getTokenPayload } from 'pocketbase'

const DAY_MS = 24 * 60 * 60 * 1000

// Tokens last 7 days by default, so this refreshes at most once a day per device.
export function sessionNeedsRefresh(token: string, now = Date.now()): boolean {
    const expires = Number(getTokenPayload(token).exp) * 1000
    return !Number.isFinite(expires) || expires - now < 6 * DAY_MS
}

export function currentSessionId(token: string): string {
    return token ? String(getTokenPayload(token).sid ?? '') : ''
}

export function signOut(pb: PocketBase) {
    const token = pb.authStore.token
    const sid = currentSessionId(token)
    pb.authStore.clear()
    if (sid)
        pb.collection('sessions')
            .delete(sid, {
                headers: { Authorization: token },
                requestKey: null,
            })
            .catch(() => {})
}
