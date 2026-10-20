import { describe, expect, it } from 'vitest'
import { ApiError } from '~/api/client'
import {
    apiFieldErrors,
    blockedFieldError,
    formFieldErrors,
    linesToList,
    refusedEntries,
} from '~/utils/fieldErrors'

const apiError = (data: Record<string, { code: string }>) => ({
    response: { data },
})

describe('blockedFieldError', () => {
    it('maps blocklist codes of the given fields', () => {
        expect(
            blockedFieldError(
                apiError({ email: { code: 'validation_email_blocked' } }),
                ['username', 'email'],
            ),
        ).toEqual({ name: 'email', key: 'errors.emailBlocked' })
        expect(
            blockedFieldError(
                apiError({ name: { code: 'validation_name_protected' } }),
                ['name'],
            ),
        ).toEqual({ name: 'name', key: 'errors.nameProtected' })
    })

    it('ignores other codes and fields', () => {
        expect(
            blockedFieldError(
                apiError({ email: { code: 'validation_is_email' } }),
                ['email'],
            ),
        ).toBeNull()
        expect(
            blockedFieldError(
                apiError({ name: { code: 'validation_name_protected' } }),
                ['email'],
            ),
        ).toBeNull()
        expect(blockedFieldError(new Error('x'), ['email'])).toBeNull()
    })
})

describe('blocklist editing', () => {
    it('splits lines and drops blanks', () => {
        expect(linesToList(' spam.test \n\n*.trash.test\n')).toEqual([
            'spam.test',
            '*.trash.test',
        ])
    })

    it('names the entries the server refused', () => {
        expect(
            refusedEntries(
                apiError({
                    'blocked_emails.1': { code: 'validation_invalid_value' },
                }),
                'blocked_emails',
                ['ok.test', 'a b', 'fine.test'],
            ),
        ).toEqual(['a b'])
    })
})

describe('formFieldErrors', () => {
    const t = (key: string) => `t:${key}`
    const error = {
        response: {
            data: {
                name: { code: 'validation_required', message: 'Missing' },
                grade: { code: 'validation_invalid_value', message: 'Bad' },
                email: { code: 'validation_email_blocked', message: 'No' },
                'walls.0.name': { code: 'validation_required', message: '' },
            },
        },
    }

    it('maps the server codes of the form fields to translated messages', () => {
        expect(formFieldErrors(error, ['name', 'grade', 'email'], t)).toEqual([
            { name: 'name', message: 't:validation.required' },
            { name: 'grade', message: 't:validation.invalid' },
            { name: 'email', message: 't:errors.emailBlocked' },
        ])
    })

    it('ignores fields the form does not show and non-field errors', () => {
        expect(formFieldErrors(error, ['comment'], t)).toEqual([])
        expect(formFieldErrors(new Error('boom'), ['name'], t)).toEqual([])
    })
})

describe('apiFieldErrors', () => {
    it('reads field errors from the response body only', () => {
        expect(
            apiFieldErrors(
                apiError({ token: { code: 'validation_invalid_token' } }),
            ),
        ).toEqual({ token: { code: 'validation_invalid_token' } })
        expect(apiFieldErrors({ data: { data: { token: {} } } })).toEqual({})
        expect(apiFieldErrors(new Error('offline'))).toEqual({})
    })

    it('has no data alias on ApiError', () => {
        expect('data' in ApiError.prototype).toBe(false)
    })
})
