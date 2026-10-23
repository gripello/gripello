import { readFileSync } from 'node:fs'

const source = readFileSync(
    'app/pages/auth/confirm-email-change/[token].vue',
    'utf8',
)

describe('e-mail change confirmation page', () => {
    it('only calls a failure a wrong password when the password field says so', () => {
        const mapping = source.slice(source.indexOf('function passwordError'))
        expect(mapping).toContain('throttledErrorKey(error)')
        expect(mapping).toMatch(
            /fieldErrorCode\(error, 'newEmail'\)\) return t\('account.emailTaken'\)/,
        )
        expect(mapping).toMatch(
            /fieldErrorCode\(error, 'password'\)\)\s+return t\('account.wrongOldPassword'\)/,
        )
        expect(mapping).toContain("return t('notifications.error.unknown')")
    })
})
