import { shallowRef } from 'vue'

export const REAUTH_CHANNEL = 'gripello-reauth'
export const REAUTH_PAGE = '/auth/reauth'
export type ReauthMessage = { ok: boolean }

// The server accepts a confirmation for 5 minutes; the client stops relying on it a little earlier.
const CONFIRMATION_MS = 4.5 * 60_000
export const providerConfirmedAt = shallowRef(0)

export function markProviderConfirmed(now = Date.now()) {
    providerConfirmedAt.value = now
}

// Set by the reauth field once the account's sign-in methods are known.
export const accountWithoutPassword = shallowRef(false)

export class ProviderConfirmationMissing extends Error {}

export function providerConfirmationFresh(now = Date.now()) {
    return (
        providerConfirmedAt.value > 0 &&
        now - providerConfirmedAt.value < CONFIRMATION_MS
    )
}
