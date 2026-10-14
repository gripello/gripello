import { describe, expect, it } from 'vitest'
import { authView, authViewQuery, requiresSignIn } from '~/utils/authView'

describe('authView', () => {
    it('reads known sub-views from the query', () => {
        expect(authView('register')).toBe('register')
        expect(authView('requestReset')).toBe('requestReset')
    })

    it('falls back to the login view', () => {
        expect(authView(undefined)).toBe('login')
        expect(authView('twoFactor')).toBe('login')
        expect(authView(['register'])).toBe('login')
    })
})

describe('authViewQuery', () => {
    const callback = {
        redirect: '/e2e',
        oauth2: 'ticket',
        oauth2Error: 'failed',
        persistent: '0',
        view: 'register',
    }

    it('drops one-time sign-in params and keeps the redirect', () => {
        expect(authViewQuery(callback)).toEqual({ redirect: '/e2e' })
    })

    it('adds the requested sub-view', () => {
        expect(authViewQuery(callback, 'requestReset')).toEqual({
            redirect: '/e2e',
            view: 'requestReset',
        })
        expect(authViewQuery(callback, 'login')).toEqual({ redirect: '/e2e' })
    })
})

describe('requiresSignIn', () => {
    it('detects pages guarded by the auth middleware', () => {
        expect(requiresSignIn(['auth'])).toBe(true)
        expect(requiresSignIn('auth')).toBe(true)
        expect(requiresSignIn(undefined)).toBe(false)
        expect(requiresSignIn(['gym'])).toBe(false)
    })
})
