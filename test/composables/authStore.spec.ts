import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    AuthStore,
    authCookie,
    readCookie,
    setAuthPersistent,
    useAuthStore,
} from '~/composables/authStore'

const tokenWith = (payload: object) =>
    `x.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.y`
const validToken = tokenWith({ id: 'u1', exp: 4102444800 })
const expiredToken = tokenWith({ id: 'u1', exp: 1 })
const cookieOf = (token: string, record: object | null) =>
    `pb_auth=${encodeURIComponent(JSON.stringify({ token, record }))}`

describe('AuthStore', () => {
    beforeEach(() => {
        process.server = false
    })

    it('loads token and record from the auth cookie', () => {
        const store = new AuthStore(
            `gym=e2e; ${cookieOf(validToken, { id: 'u1' })}`,
        )
        expect(store.token).toBe(validToken)
        expect(store.record).toEqual({ id: 'u1' })
        expect(store.isValid).toBe(true)
        expect(store.persistent).toBe(true)
    })

    it('treats an expired, missing or broken token as signed out', () => {
        expect(
            new AuthStore(cookieOf(expiredToken, { id: 'u1' })).isValid,
        ).toBe(false)
        expect(new AuthStore('').isValid).toBe(false)
        expect(new AuthStore('pb_auth=%7Bbroken').token).toBe('')
    })

    it('notifies listeners on save and clear', () => {
        const store = new AuthStore('')
        const changes: string[] = []
        const stop = store.onChange((token) => changes.push(token), true)
        store.save(validToken, { id: 'u1' })
        stop()
        store.clear()
        expect(changes).toEqual(['', validToken])
        expect(store.record).toBeNull()
    })

    it('reads the request cookie on the server', () => {
        process.server = true
        vi.stubGlobal('useRequestHeaders', () => ({
            cookie: cookieOf(validToken, { id: 'u1' }),
        }))
        expect(useAuthStore().record).toEqual({ id: 'u1' })
        process.server = false
    })

    it('persists the login in the cookie until the token expires', () => {
        const store = useAuthStore()
        store.save(validToken, { id: 'u1' })
        expect(JSON.parse(readCookie(document.cookie, 'pb_auth'))).toEqual({
            token: validToken,
            record: { id: 'u1' },
        })
        expect(useAuthStore()).toBe(store)
        store.clear()
        expect(readCookie(document.cookie, 'pb_auth')).toBe('')
    })

    it('writes a session cookie when remember me is off', () => {
        const store = useAuthStore()
        setAuthPersistent(false)
        store.save(validToken, { id: 'u1' })
        expect(document.cookie).toContain('pb_auth_session=1')

        setAuthPersistent(true)
        store.save(validToken, { id: 'u1' })
        expect(document.cookie).not.toContain('pb_auth_session=1')
    })
})

describe('authCookie', () => {
    it('expires with the token, or at session end', () => {
        expect(authCookie(validToken, null)).toContain(
            'Expires=Fri, 01 Jan 2100 00:00:00 GMT',
        )
        expect(authCookie(validToken, null, { session: true })).not.toContain(
            'Expires',
        )
        expect(authCookie('', null)).toContain('Expires=Thu, 01 Jan 1970')
        expect(authCookie(validToken, null)).toMatch(
            /; Path=\/; Expires=.*; SameSite=Lax$/,
        )
    })

    it('trims a record that would exceed 4 KB', () => {
        const record = {
            id: 'u1',
            email: 'a@b.c',
            verified: true,
            collectionName: 'users',
            bio: 'x'.repeat(5000),
        }
        const value = authCookie(validToken, record).split(';')[0]!
        expect(JSON.parse(readCookie(value, 'pb_auth')).record).toEqual({
            id: 'u1',
            email: 'a@b.c',
            verified: true,
            collectionName: 'users',
        })
    })
})
