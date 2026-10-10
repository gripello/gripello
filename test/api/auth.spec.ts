import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    confirmEmailChange,
    confirmPasswordReset,
    confirmVerification,
    login,
    loginWithRecoveryCode,
    loginWithTOTP,
    logout,
    mfaRequired,
    passkeyLogin,
    passkeyLoginOptions,
    refreshAuth,
    register,
    requestEmailChange,
    requestPasswordReset,
    requestVerification,
    useAuthState,
} from '~/api/auth'
import { mockApi } from './apiMock'

const token = `x.${btoa(JSON.stringify({ sid: 's1', exp: 4102444800 }))}.y`
const newToken = `x.${btoa(JSON.stringify({ sid: 's2', exp: 4102444800 }))}.z`

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

describe('useAuthState', () => {
    it('reads, saves and clears the auth store', () => {
        const auth = useAuthState()
        const changes: string[] = []
        auth.onAuthChange((value) => changes.push(value))
        auth.saveAuth({ token, record: { id: 'u1' } as never })
        expect(auth.isSignedIn()).toBe(true)
        expect(auth.currentUserId()).toBe('u1')
        expect(auth.token()).toBe(token)
        auth.saveUser({ id: 'u1', name: 'Ann' } as never)
        expect(auth.currentUser()).toEqual({ id: 'u1', name: 'Ann' })
        auth.clearAuth()
        expect(auth.isSignedIn()).toBe(false)
        expect(changes).toEqual([token, token, ''])
    })
})

describe('login', () => {
    it('posts the credentials with the captcha header and stores the session', async () => {
        api.respond({ token, record: { id: 'u1' } })
        await login('ann', 'secret', { 'X-Cap-Token': 'cap' })
        const sent = api.request()
        expect(sent.url).toBe('/api/auth/login')
        expect(sent.method).toBe('POST')
        expect(sent.body).toEqual({ identity: 'ann', password: 'secret' })
        expect(sent.headers.get('X-Cap-Token')).toBe('cap')
        expect(useAuthState().token()).toBe(token)
        expect(useAuthState().currentUserId()).toBe('u1')
    })

    it('reads the second-factor shape of a 401 without signing out', async () => {
        useAuthState().saveAuth({ token, record: { id: 'u1' } as never })
        api.respond({ mfaId: 'm', methods: ['passkey'] }, 401)
        const error = await login('ann', 'secret').catch((e) => e)
        expect(mfaRequired(error)).toEqual({ mfaId: 'm', methods: ['passkey'] })
        expect(useAuthState().isSignedIn()).toBe(true)
        expect(mfaRequired({ response: { mfaId: 'm' } })).toEqual({
            mfaId: 'm',
            methods: ['totp', 'recovery'],
        })
        expect(mfaRequired(new Error('invalid'))).toBeNull()
    })
})

describe('second factors', () => {
    it('posts the code to the method endpoint', async () => {
        await loginWithTOTP('m', '123456')
        expect(api.request()).toMatchObject({
            url: '/api/auth/totp',
            method: 'POST',
            body: { mfaId: 'm', code: '123456' },
        })
        await loginWithRecoveryCode('m', 'abcd-efgh')
        expect(api.request()).toMatchObject({
            url: '/api/auth/recovery',
            body: { mfaId: 'm', code: 'abcd-efgh' },
        })
    })

    it('runs the passkey ceremony with an optional mfaId', async () => {
        await passkeyLoginOptions()
        expect(api.request()).toMatchObject({
            url: '/api/auth/passkey/options',
            method: 'POST',
        })
        await passkeyLogin({ ceremony: 'c', credential: { id: 'k' } })
        expect(api.request().body).toEqual({
            ceremony: 'c',
            credential: { id: 'k' },
        })
        await passkeyLogin({ ceremony: 'c', credential: {} }, 'm')
        expect(api.request().body).toEqual({
            ceremony: 'c',
            credential: {},
            mfaId: 'm',
        })
    })
})

describe('session', () => {
    it('refreshes the token with the current one and stores the new login', async () => {
        useAuthState().saveAuth({ token, record: { id: 'u1' } as never })
        api.respond({ token: newToken, record: { id: 'u1' } })
        await refreshAuth()
        expect(api.request()).toMatchObject({
            url: '/api/auth/refresh',
            method: 'POST',
        })
        expect(api.request().headers.get('Authorization')).toBe(
            `Bearer ${token}`,
        )
        expect(useAuthState().token()).toBe(newToken)
    })

    it('signs out locally and ends the session with the old token', async () => {
        useAuthState().saveAuth({ token, record: { id: 'u1' } as never })
        api.fetchMock.mockReturnValue(new Promise(() => {}))
        logout()
        expect(useAuthState().isSignedIn()).toBe(false)
        await vi.waitFor(() => expect(api.fetchMock).toHaveBeenCalled())
        const sent = api.request()
        expect(sent.url).toBe('/api/auth/logout')
        expect(sent.headers.get('Authorization')).toBe(`Bearer ${token}`)
    })

    it('clears the session when the API rejects the token', async () => {
        useAuthState().saveAuth({ token, record: { id: 'u1' } as never })
        api.respond({ status: 401, message: 'expired', data: {} }, 401)
        const error = await refreshAuth().catch((e) => e)
        expect(error.status).toBe(401)
        expect(useAuthState().isSignedIn()).toBe(false)
    })
})

describe('register', () => {
    it('posts the account with the captcha header', async () => {
        const input = {
            email: 'a@b.c',
            username: 'ann',
            password: 'pw',
            passwordConfirm: 'pw',
            language: 'de',
        }
        const result = await register(input, { 'X-Cap-Token': 'cap' })
        const sent = api.request()
        expect(sent.url).toBe('/api/auth/register')
        expect(sent.body).toEqual(input)
        expect(sent.headers.get('X-Cap-Token')).toBe('cap')
        expect(result).toEqual({ verificationSent: true })
    })
})

describe('verification request', () => {
    it('sends the captcha header', async () => {
        await requestVerification('a@b.c', { 'X-Cap-Token': 'cap' })
        expect(api.request().headers.get('X-Cap-Token')).toBe('cap')
    })
})

describe('token flows', () => {
    it('requests and confirms resets, verifications and email changes', async () => {
        const calls: [() => Promise<unknown>, string, object][] = [
            [
                () => requestPasswordReset('a@b.c'),
                '/auth/password-reset/request',
                { email: 'a@b.c' },
            ],
            [
                () => confirmPasswordReset('t', 'pw', 'pw'),
                '/auth/password-reset/confirm',
                { token: 't', password: 'pw', passwordConfirm: 'pw' },
            ],
            [
                () => requestVerification('a@b.c'),
                '/auth/verification/request',
                { email: 'a@b.c' },
            ],
            [
                () => confirmVerification('t'),
                '/auth/verification/confirm',
                { token: 't' },
            ],
            [
                () => requestEmailChange('new@b.c'),
                '/auth/email-change/request',
                { newEmail: 'new@b.c' },
            ],
            [
                () => confirmEmailChange('t', 'pw'),
                '/auth/email-change/confirm',
                { token: 't', password: 'pw' },
            ],
        ]
        for (const [call, path, body] of calls) {
            await call()
            expect(api.request()).toMatchObject({
                url: `/api${path}`,
                method: 'POST',
                body,
            })
        }
    })
})
