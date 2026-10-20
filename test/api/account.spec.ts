import { beforeEach, describe, expect, it } from 'vitest'
import {
    changePassword,
    deleteAvatar,
    deleteBanner,
    deleteMe,
    deleteMFAFactor,
    dataExportAvailable,
    dataExportUrl,
    getOwnDataExport,
    ownDataExportUrl,
    requestDataExport,
    followWall,
    getMe,
    listLinkedAccounts,
    listMFAFactors,
    listOwnMemberships,
    listSessions,
    passkeyRegister,
    passkeyRegistrationOptions,
    reauthenticate,
    regenerateRecoveryCodes,
    renameMFAFactor,
    revokeSession,
    signOutOtherSessions,
    totpEnable,
    totpSetup,
    unfollowWall,
    unlinkAccount,
    updateMe,
} from '~/api/account'
import { useAuthState } from '~/api/auth'
import { jsonResponse, mockApi } from './apiMock'

const token = `x.${btoa(JSON.stringify({ exp: 4102444800 }))}.y`

const ownMembership = {
    id: 'm1',
    created: '2026-01-01',
    gym: { id: 'g1', slug: 'gym', name: 'Gym', active: true },
    role: {
        id: 'r1',
        gym: 'g1',
        name: 'admin',
        permissions: ['manage_routes'],
    },
}

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
    useAuthState().saveAuth({ token, record: { id: 'u1' } as never })
})

describe('getMe', () => {
    it('reads the signed-in user with the bearer token', async () => {
        api.respond({ id: 'u1' })
        expect(await getMe()).toEqual({ id: 'u1' })
        expect(api.request().url).toBe('/api/me')
        expect(api.request().headers.get('Authorization')).toBe(
            `Bearer ${token}`,
        )
    })

    it('includes memberships as Go sends them', async () => {
        api.fetchMock.mockImplementation(async (url: string) =>
            jsonResponse(
                url.endsWith('/me/memberships')
                    ? [ownMembership]
                    : { id: 'u1' },
            ),
        )
        const me = await getMe({ include: ['memberships'] })
        expect(me).toEqual({ id: 'u1', memberships: [ownMembership] })
        expect(me).not.toHaveProperty('expand')
        expect(await listOwnMemberships()).toEqual([ownMembership])
    })
})

describe('updateMe', () => {
    it('patches JSON and keeps the auth store current', async () => {
        api.respond({ id: 'u1', firstname: 'Ann' })
        await updateMe({ firstname: 'Ann' })
        expect(api.request()).toMatchObject({
            url: '/api/me',
            method: 'PATCH',
            body: { firstname: 'Ann' },
        })
        expect(useAuthState().currentUser()).toEqual({
            id: 'u1',
            firstname: 'Ann',
        })
        expect(useAuthState().token()).toBe(token)
    })

    it('sends files as multipart with the other fields in @jsonPayload', async () => {
        const form = new FormData()
        const avatar = new Blob(['x'], { type: 'image/png' })
        form.append('firstname', 'Ann')
        form.append('avatar', avatar)
        form.append('banner', '')
        await updateMe(form)
        const body = api.request().body as FormData
        expect(body).toBeInstanceOf(FormData)
        expect(body.get('avatar')).toBeInstanceOf(Blob)
        expect(JSON.parse(String(body.get('@jsonPayload')))).toEqual({
            firstname: 'Ann',
            banner: '',
        })
    })

    it('follows and unfollows single walls', async () => {
        api.respond({ id: 'u1', followed_walls: ['w1'] })
        await followWall('w1')
        expect(api.request()).toMatchObject({
            url: '/api/me/followed-walls/w1',
            method: 'POST',
        })
        expect(useAuthState().currentUser()).toMatchObject({
            followed_walls: ['w1'],
        })
        await unfollowWall('w1')
        expect(api.request()).toMatchObject({
            url: '/api/me/followed-walls/w1',
            method: 'DELETE',
        })
    })

    it('clears avatar and banner through their endpoints', async () => {
        await deleteAvatar()
        expect(api.request()).toMatchObject({
            url: '/api/me/avatar',
            method: 'DELETE',
        })
        await deleteBanner()
        expect(api.request()).toMatchObject({
            url: '/api/me/banner',
            method: 'DELETE',
        })
    })
})

describe('account', () => {
    it('changes the password and stores the new login', async () => {
        api.respond({ token: 'next', record: { id: 'u1' } })
        const change = {
            oldPassword: 'old',
            password: 'new',
            passwordConfirm: 'new',
        }
        expect(await changePassword(change)).toEqual({ id: 'u1' })
        expect(api.request()).toMatchObject({
            url: '/api/me/password',
            method: 'POST',
            body: change,
        })
        expect(useAuthState().token()).toBe('next')
    })

    it('exposes field errors like the forms expect', async () => {
        const failure = {
            status: 400,
            message: 'Failed.',
            data: { oldPassword: { code: 'validation_invalid_old_password' } },
        }
        api.respond(failure, 400)
        const error = await changePassword({
            oldPassword: 'x',
            password: 'y',
            passwordConfirm: 'y',
        }).catch((e) => e)
        expect(error.status).toBe(400)
        expect(error.response.data.oldPassword.code).toBe(
            'validation_invalid_old_password',
        )
        expect(error.response).toEqual(failure)
        expect(useAuthState().isSignedIn()).toBe(true)
    })

    it('confirms the password for sensitive admin actions', async () => {
        await reauthenticate('secret')
        expect(api.request()).toMatchObject({
            url: '/api/me/reauthenticate',
            method: 'POST',
            body: { password: 'secret' },
        })
    })

    it('lists and unlinks sign-in providers', async () => {
        api.respond({ items: [], hasPassword: true })
        expect(await listLinkedAccounts()).toEqual({
            items: [],
            hasPassword: true,
        })
        expect(api.request().url).toBe('/api/me/identities')
        await unlinkAccount('i1')
        expect(api.request()).toMatchObject({
            url: '/api/me/identities/i1',
            method: 'DELETE',
        })
    })

    it('deletes the account with the current password', async () => {
        await deleteMe('secret')
        expect(api.request()).toMatchObject({
            url: '/api/me',
            method: 'DELETE',
            body: { password: 'secret' },
        })
    })
})

describe('data export', () => {
    it('asks for an export to be mailed', async () => {
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))
        await requestDataExport()
        expect(api.request()).toMatchObject({
            url: '/api/me/export',
            method: 'POST',
        })
    })

    it('rejects with the status when refused', async () => {
        api.respond({ status: 429, message: 'Too many', data: {} }, 429)
        await expect(requestDataExport()).rejects.toMatchObject({
            status: 429,
        })
    })

    it('links the download and checks it without a body', async () => {
        expect(dataExportUrl('a/b')).toBe('/api/account/export/a%2Fb')
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
        expect(await dataExportAvailable('tok')).toBe(true)
        expect(api.request()).toMatchObject({
            url: '/api/account/export/tok',
            method: 'HEAD',
        })
        api.respond({ status: 404, message: 'Not found', data: {} }, 404)
        expect(await dataExportAvailable('gone')).toBe(false)
        api.respond({ status: 503, message: 'Down', data: {} }, 503)
        await expect(dataExportAvailable('tok')).rejects.toMatchObject({
            status: 503,
        })
    })

    it('reads the own export state and links its download without a token', async () => {
        api.respond({
            status: 'too_large',
            created: '2026-01-01T00:00:00.000Z',
        })
        expect(await getOwnDataExport()).toEqual({
            status: 'too_large',
            created: '2026-01-01T00:00:00.000Z',
        })
        expect(api.request()).toMatchObject({ url: '/api/me/export' })
        expect(ownDataExportUrl()).toBe('/api/me/export/file')
    })
})

describe('second factors', () => {
    it('lists, renames and removes factors', async () => {
        await listMFAFactors()
        expect(api.request()).toMatchObject({
            url: '/api/me/mfa',
            method: 'GET',
        })
        await renameMFAFactor('f1', 'Phone')
        expect(api.request()).toMatchObject({
            url: '/api/me/mfa/f1',
            method: 'PATCH',
            body: { name: 'Phone' },
        })
        await deleteMFAFactor('f1', 'pw')
        expect(api.request()).toMatchObject({
            url: '/api/me/mfa/f1',
            method: 'DELETE',
            body: { password: 'pw' },
        })
    })

    it('sets up an authenticator and renews recovery codes', async () => {
        await totpSetup('pw')
        expect(api.request()).toMatchObject({
            url: '/api/me/totp/setup',
            body: { password: 'pw' },
        })
        await totpEnable({ password: 'pw', secret: 's', code: '1' })
        expect(api.request()).toMatchObject({
            url: '/api/me/totp',
            body: { password: 'pw', secret: 's', code: '1' },
        })
        await regenerateRecoveryCodes('pw')
        expect(api.request()).toMatchObject({
            url: '/api/me/recovery-codes',
            body: { password: 'pw' },
        })
    })

    it('registers a passkey', async () => {
        await passkeyRegistrationOptions('pw')
        expect(api.request()).toMatchObject({
            url: '/api/me/passkeys/options',
            body: { password: 'pw' },
        })
        await passkeyRegister({ ceremony: 'c', credential: {}, name: 'Key' })
        expect(api.request()).toMatchObject({
            url: '/api/me/passkeys',
            body: { ceremony: 'c', credential: {}, name: 'Key' },
        })
    })
})

describe('sessions', () => {
    it('lists, revokes and signs out the others', async () => {
        api.respond({ items: [{ id: 's1' }] })
        expect(await listSessions()).toEqual([{ id: 's1' }])
        expect(api.request().url).toBe('/api/me/sessions')
        await revokeSession('s1')
        expect(api.request()).toMatchObject({
            url: '/api/me/sessions/s1',
            method: 'DELETE',
        })
        api.respond({ token: 'kept-session', record: { id: 'u1' } })
        await signOutOtherSessions()
        expect(api.request()).toMatchObject({
            url: '/api/me/sessions/sign-out-others',
            method: 'POST',
        })
        expect(useAuthState().token()).toBe('kept-session')
    })
})
