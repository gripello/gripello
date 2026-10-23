import { readFileSync } from 'node:fs'

const source = readFileSync('app/pages/auth/login.vue', 'utf8')

describe('login page', () => {
    it('keeps a signed-in session unless the refresh rejects it', () => {
        expect(source).toMatch(
            /await refreshAuth\(\)\s+\} catch \(err\) \{\s+if \(sessionRejected\(err\)\) auth.clearAuth\(\)/,
        )
    })

    it('lets signed-in accounts request a password reset', () => {
        expect(source).toContain(
            "if (auth.isSignedIn() && authView(route.query.view) !== 'requestReset')",
        )
    })

    it('applies the current remember-me choice to every finished login', () => {
        expect(source).toMatch(
            /async function finishLogin\(result: AuthResult\) \{\s+loading.value = true\s+setAuthPersistent\(rememberMe.value\)\s+auth.saveAuth\(result\)/,
        )
    })
})
