export function isInvalidCredentials(message: string) {
    return /invalid.+credentials|failed to authenticate/i.test(message)
}

export type AuthErrorKind =
    | 'suspended'
    | 'unverified'
    | 'invalidCredentials'
    | 'locked'
    | 'rateLimited'
    | 'mfaExpired'
    | 'captcha'
    | 'unknown'

export const AUTH_ERROR_KEYS: Record<AuthErrorKind, string> = {
    suspended: 'notifications.error.account_suspended',
    unverified: 'notifications.error.email_not_verified',
    invalidCredentials: 'notifications.error.invalid_credentials',
    locked: 'notifications.error.account_locked',
    rateLimited: 'notifications.error.too_many_attempts',
    mfaExpired: 'notifications.error.mfa_expired',
    captcha: 'notifications.error.captcha',
    unknown: 'notifications.error.unknown',
}

const CREDENTIAL_KINDS = new Set<AuthErrorKind>([
    'suspended',
    'invalidCredentials',
    'locked',
    'rateLimited',
])

export function authErrorMessage(err: unknown) {
    const { data, message } = (err ?? {}) as {
        data?: { message?: string }
        message?: string
    }
    return data?.message ?? message ?? ''
}

export function authErrorKind(err: unknown): AuthErrorKind {
    const status = (err as { status?: number } | null)?.status
    const message = authErrorMessage(err)
    if (/suspended/i.test(message)) return 'suspended'
    if (status === 403 || /not verified/i.test(message)) return 'unverified'
    if (status === 429)
        return /locked/i.test(message) ? 'locked' : 'rateLimited'
    if (isInvalidCredentials(message)) return 'invalidCredentials'
    if (/MFA session/i.test(message)) return 'mfaExpired'
    if (/captcha/i.test(message)) return 'captcha'
    return 'unknown'
}

export function isCredentialError(err: unknown) {
    return CREDENTIAL_KINDS.has(authErrorKind(err))
}

export function sessionRejected(err: unknown) {
    const status = (err as { status?: number } | null)?.status
    return status === 401 || status === 403
}

export function throttledErrorKey(err: unknown) {
    const kind = authErrorKind(err)
    if (kind === 'locked') return AUTH_ERROR_KEYS.locked
    if (kind === 'rateLimited') return 'errors.rateLimited'
    return null
}
