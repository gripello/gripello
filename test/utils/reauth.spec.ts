import { describe, expect, it } from 'vitest'
import { isWrongPassword, needsPasswordFirst } from '~/utils/reauth'

describe('isWrongPassword', () => {
    it('recognises the invalid_password field code only', () => {
        expect(
            isWrongPassword({
                response: { data: { password: { code: 'invalid_password' } } },
            }),
        ).toBe(true)
        expect(
            isWrongPassword({
                response: {
                    data: { smtp_port: { code: 'validation_invalid_port' } },
                },
            }),
        ).toBe(false)
        expect(isWrongPassword(new Error('offline'))).toBe(false)
        expect(isWrongPassword(undefined)).toBe(false)
    })
})

describe('needsPasswordFirst', () => {
    it('recognises password_required on any password field', () => {
        expect(
            needsPasswordFirst({
                response: { data: { password: { code: 'password_required' } } },
            }),
        ).toBe(true)
        expect(
            needsPasswordFirst({
                response: {
                    data: { oldPassword: { code: 'password_required' } },
                },
            }),
        ).toBe(true)
        expect(
            needsPasswordFirst({
                response: { data: { password: { code: 'invalid_password' } } },
            }),
        ).toBe(false)
        expect(needsPasswordFirst(new Error('offline'))).toBe(false)
        expect(needsPasswordFirst(undefined)).toBe(false)
    })
})
