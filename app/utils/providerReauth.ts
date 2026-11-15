import { shallowRef } from 'vue'

export const REAUTH_CHANNEL = 'gripello-reauth'
export const REAUTH_PAGE = '/auth/reauth'
export type ReauthMessage = { ok: boolean }

// The server accepts a confirmation for 5 minutes; the client stops relying on it a little earlier.
const CONFIRMATION_MS = 4.5 * 60_000
// Bound to the account that confirmed, so a sign-in as someone else in this tab starts over.
export const providerConfirmation = shallowRef<{
    user: string
    at: number
} | null>(null)

export function markProviderConfirmed(user: string, now = Date.now()) {
    providerConfirmation.value = { user, at: now }
}

export function providerConfirmationFresh(
    user: string | undefined,
    now = Date.now(),
) {
    const confirmation = providerConfirmation.value
    return (
        !!user &&
        confirmation?.user === user &&
        now - confirmation.at < CONFIRMATION_MS
    )
}

// Set by the reauth field once the account's sign-in methods are known.
export const accountWithoutPassword = shallowRef(false)

// An expected state, not a bug: the 4xx status keeps it out of the client error log.
export class ProviderConfirmationMissing extends Error {
    readonly statusCode = 403
}
