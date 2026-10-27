import { readFileSync } from 'node:fs'
import path from 'node:path'

const page = (name: string) =>
    readFileSync(
        path.resolve(import.meta.dirname, `../../app/pages/auth/${name}.vue`),
        'utf8',
    )

describe('auth token pages', () => {
    it.each(['invite/[token]', 'gym/[token]'])(
        '%s calls a link invalid only on 404 and offers a retry otherwise',
        (name) => {
            const source = page(name)
            expect(source).toContain('nullIfNotFound(')
            expect(source).not.toContain('.catch(() => null)')
            expect(source).toMatch(/<LayoutLoadError[^>]*@retry="refresh\(\)"/)
        },
    )

    it('verifies an address only with the password of the sign-up that sent the link', () => {
        const source = page('confirm-verification/[token]')
        expect(source).not.toMatch(/<AuthTokenAction[^>]*\sauto[\s>]/)
        expect(source).toContain('data-testid="verify-password"')
        expect(source).toContain('confirmVerification(token, password.value)')
    })

    it('signs out on the server from the wrong-account step', () => {
        expect(page('invite/[token]')).toMatch(
            /function signOut\(\) \{\n\s+logout\(\)/,
        )
    })
})
