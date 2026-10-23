import { describe, expect, it } from 'vitest'
import {
    AUTH_ERROR_KEYS,
    authErrorKind,
    isCredentialError,
    isInvalidCredentials,
    sessionRejected,
    throttledErrorKey,
} from '~/utils/authErrors'

describe('isInvalidCredentials', () => {
    it('recognises the wrong-password answer of the login endpoint', () => {
        expect(isInvalidCredentials('Failed to authenticate.')).toBe(true)
        expect(isInvalidCredentials('Invalid login credentials.')).toBe(true)
    })

    it('leaves other auth errors alone', () => {
        expect(isInvalidCredentials('Invalid or expired MFA session.')).toBe(
            false,
        )
        expect(isInvalidCredentials('This account is suspended.')).toBe(false)
    })
})

describe('authErrorKind', () => {
    const apiError = (status: number, message = '') => ({
        status,
        data: { message },
    })

    it('tells a locked account apart from a plain rate limit by status', () => {
        expect(
            authErrorKind(
                apiError(429, 'Account temporarily locked. Try again later.'),
            ),
        ).toBe('locked')
        expect(authErrorKind(apiError(429, 'Too many requests.'))).toBe(
            'rateLimited',
        )
        expect(authErrorKind({ status: 429 })).toBe('rateLimited')
        expect(AUTH_ERROR_KEYS.locked).toBe(
            'notifications.error.account_locked',
        )
    })

    it('classifies the other sign-in answers', () => {
        expect(authErrorKind(apiError(403, 'This account is suspended.'))).toBe(
            'suspended',
        )
        expect(
            authErrorKind(apiError(403, 'The account is not verified.')),
        ).toBe('unverified')
        expect(authErrorKind(apiError(400, 'Failed to authenticate.'))).toBe(
            'invalidCredentials',
        )
        expect(
            authErrorKind(apiError(400, 'Invalid or expired MFA session.')),
        ).toBe('mfaExpired')
        expect(authErrorKind(apiError(500))).toBe('unknown')
    })

    it('shows credential, lock and rate limit errors on the password field', () => {
        expect(isCredentialError(apiError(429))).toBe(true)
        expect(
            isCredentialError(apiError(400, 'Failed to authenticate.')),
        ).toBe(true)
        expect(isCredentialError(apiError(403, 'not verified'))).toBe(false)
        expect(isCredentialError(apiError(500))).toBe(false)
    })
})

const failure = (status: number, message = '') => ({
    status,
    data: { message },
})

describe('sessionRejected', () => {
    it('only treats 401 and 403 as a dead session', () => {
        expect(sessionRejected(failure(401))).toBe(true)
        expect(sessionRejected(failure(403))).toBe(true)
        expect(sessionRejected(failure(429))).toBe(false)
        expect(sessionRejected(failure(503))).toBe(false)
        expect(sessionRejected(new TypeError('Failed to fetch'))).toBe(false)
    })
})

describe('throttledErrorKey', () => {
    it('names a lockout or a rate limit and nothing else', () => {
        expect(
            throttledErrorKey(
                failure(429, 'Account temporarily locked. Try again later.'),
            ),
        ).toBe('notifications.error.account_locked')
        expect(throttledErrorKey(failure(429, 'Too many requests.'))).toBe(
            'errors.rateLimited',
        )
        expect(throttledErrorKey(failure(400))).toBeNull()
    })
})
