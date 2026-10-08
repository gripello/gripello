import { describe, expect, it, vi } from 'vitest'
import { currentSessionId, sessionNeedsRefresh, signOut } from '~/utils/session'

const DAY_MS = 24 * 60 * 60 * 1000
const tokenExpiringAt = (ms: number) =>
    `x.${btoa(JSON.stringify({ exp: Math.floor(ms / 1000) }))}.y`

describe('sessionNeedsRefresh', () => {
    const now = Date.UTC(2026, 9, 5)

    it('leaves a token alone during its first day', () => {
        expect(
            sessionNeedsRefresh(tokenExpiringAt(now + 6.5 * DAY_MS), now),
        ).toBe(false)
    })

    it('refreshes a token older than a day or one it cannot read', () => {
        expect(
            sessionNeedsRefresh(tokenExpiringAt(now + 5 * DAY_MS), now),
        ).toBe(true)
        expect(sessionNeedsRefresh('not-a-token', now)).toBe(true)
    })
})

describe('signOut', () => {
    const token = `x.${btoa(JSON.stringify({ sid: 's1' }))}.y`

    it('reads the session id from the token', () => {
        expect(currentSessionId(token)).toBe('s1')
        expect(currentSessionId('')).toBe('')
    })

    it('signs out locally without waiting for the server', () => {
        const remove = vi.fn(() => new Promise(() => {}))
        const clear = vi.fn()
        const pb = {
            authStore: { token, clear },
            collection: () => ({ delete: remove }),
        } as unknown as Parameters<typeof signOut>[0]
        signOut(pb)
        expect(clear).toHaveBeenCalled()
        expect(remove).toHaveBeenCalledWith('s1', {
            headers: { Authorization: token },
            requestKey: null,
        })
    })
})
