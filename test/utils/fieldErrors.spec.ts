import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ApiError } from '~/api/client'
import {
    apiFieldErrors,
    blockedFieldError,
    FIELD_MESSAGE_KEYS,
    formFieldErrors,
    LIMIT_CODES,
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

    it('turns server limits into localized messages', () => {
        const tp = (key: string, params?: Record<string, unknown>) =>
            `${key}${params ? JSON.stringify(params) : ''}`
        const message = (code: string, text: string) =>
            formFieldErrors(apiErrorWith(code, text), ['x'], tp)[0]!.message
        const apiErrorWith = (code: string, text: string) => ({
            response: { data: { x: { code, message: text } } },
        })
        expect(
            message(
                'validation_invalid_value',
                'Must be no more than 100 characters.',
            ),
        ).toBe('validation.maxLength{"n":100}')
        expect(
            message(
                'validation_length_out_of_range',
                'Must be at least 8 characters.',
            ),
        ).toBe('validation.minLength{"n":8}')
        expect(
            message(
                'validation_length_out_of_range',
                'The length must be between 3 and 150.',
            ),
        ).toBe('validation.lengthRange{"min":3,"max":150}')
        expect(
            message(
                'validation_length_out_of_range',
                'Enter 3 to 100 letters.',
            ),
        ).toBe('validation.lengthRange{"min":3,"max":100}')
        expect(
            message('validation_out_of_range', 'Must be between 0 and 23.'),
        ).toBe('validation.integerRange{"min":0,"max":23}')
        expect(
            message('validation_too_many_values', 'Select no more than 50.'),
        ).toBe('validation.tooMany{"n":50}')
        expect(message('validation_invalid_value', 'Must be at least 1.')).toBe(
            'validation.atLeast{"n":1}',
        )
        expect(
            message('validation_invalid_value', 'Must be a day as YYYY-MM-DD.'),
        ).toBe('validation.date')
        expect(
            message('validation_invalid_date', 'Must be a date in the future.'),
        ).toBe('validation.futureDate')
        expect(
            message('validation_invalid_value', 'The note is too long.'),
        ).toBe('validation.tooLong')
        expect(
            message(
                'validation_invalid_website_url',
                'Must be at most 500 characters.',
            ),
        ).toBe('validation.maxLength{"n":500}')
        expect(message('validation_not_unique', 'Value must be unique.')).toBe(
            'validation.notUnique',
        )
        expect(message('validation_invalid_value', 'Unknown route.')).toBe(
            'validation.invalid',
        )
    })

    it('has a message for every field error code the Go backend sends', () => {
        const handledElsewhere = [
            'validation_invalid_map',
            'validation_invalid_outline',
            'validation_invalid_edge',
            'validation_invalid_label',
            'validation_pk_invalid',
            'validation_invalid_sort',
            'validation_json_size_limit',
        ]
        const backend = join(__dirname, '../../backend')
        const codes = new Set<string>()
        for (const file of readdirSync(backend, {
            recursive: true,
        }) as string[]) {
            if (!file.endsWith('.go') || file.endsWith('_test.go')) continue
            const source = readFileSync(join(backend, file), 'utf8')
            for (const [, code] of source.matchAll(/"(validation_[a-z_]+)"/g))
                codes.add(code!)
        }
        expect(codes.size).toBeGreaterThan(30)
        const unmapped = [...codes].filter(
            (code) =>
                !(code in FIELD_MESSAGE_KEYS) &&
                !LIMIT_CODES.has(code) &&
                code !== 'validation_invalid_' &&
                !handledElsewhere.includes(code),
        )
        expect(unmapped).toEqual([])
        const en = JSON.parse(
            readFileSync(join(__dirname, '../../i18n/locales/en.json'), 'utf8'),
        )
        const missing = Object.values(FIELD_MESSAGE_KEYS).filter(
            (key) =>
                typeof key.split('.').reduce((o, k) => o?.[k], en) !== 'string',
        )
        expect(missing).toEqual([])
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
