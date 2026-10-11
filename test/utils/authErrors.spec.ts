import { describe, expect, it } from 'vitest'
import { isInvalidCredentials } from '~/utils/authErrors'

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
