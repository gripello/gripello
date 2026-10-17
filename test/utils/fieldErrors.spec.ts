import { describe, expect, it } from 'vitest'
import {
    blockedFieldError,
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
