import { describe, expect, it } from 'vitest'
import {
    AUTH_ERROR_KEYS,
    authErrorKind,
    isCredentialError,
    isInvalidCredentials,
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
