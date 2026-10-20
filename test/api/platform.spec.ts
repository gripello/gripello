import { beforeEach, describe, expect, it } from 'vitest'
import {
    clearUserLockout,
    deletePlatformUser,
    getMailSettings,
    platformStats,
    getPlatformSystem,
    getPlatformTraffic,
    getPlatformUser,
    grantPlatformAdmin,
    liftSuspension,
    listFeatureFlags,
    listOAuthProviderSettings,
    listPlatformUsers,
    listServerLogs,
    resetUserMfa,
    revokePlatformAdmin,
    revokeUserSessions,
    saveOAuthProviderSettings,
    sendTestMail,
    setGymFeatures,
    setLogLevel,
    setUserPassword,
    suspendUser,
    updateMailSettings,
    updatePlatformUser,
} from '~/api/platform'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

const apiUser = {
    id: 'u1',
    email: 'ada@example.com',
    memberships: [{ id: 'm1', gym: 'g1', role: 'r1' }],
}

const platformUser = apiUser

beforeEach(() => {
    api = mockApi()
})

describe('platform users', () => {
    it('pages a search and keeps the memberships as Go sends them', async () => {
        api.respond({ items: [apiUser], page: 2, limit: 20, total: 21 })
        const result = await listPlatformUsers({
            q: ' ada@ ',
            filter: 'suspended',
            page: 2,
            limit: 20,
        })
        expect(result).toEqual({
            items: [platformUser],
            page: 2,
            limit: 20,
            total: 21,
        })
        expect(api.request().url).toBe(
            '/api/platform/users?q=ada@&filter=suspended&page=2&limit=20',
        )
    })

    it('lists every match without a page', async () => {
        api.respond({ items: [], page: 1, limit: 0, total: 0 })
        await listPlatformUsers({ filter: 'platform_admins' })
        expect(api.request().url).toBe(
            '/api/platform/users?filter=platform_admins&limit=0',
        )
    })

    it('reads, updates and deletes a user', async () => {
        api.respond(apiUser)
        expect(await getPlatformUser('u1')).toEqual(platformUser)
        expect(api.request().url).toBe('/api/platform/users/u1')

        api.respond(apiUser)
        await updatePlatformUser('u1', { name: 'Ada' }, { avatar: null })
        expect(api.request()).toMatchObject({
            url: '/api/platform/users/u1',
            method: 'PATCH',
            body: { name: 'Ada', avatar: null },
        })

        await deletePlatformUser('u1')
        expect(api.request()).toMatchObject({
            url: '/api/platform/users/u1',
            method: 'DELETE',
        })
    })

    it('uploads a new avatar as multipart', async () => {
        api.respond(apiUser)
        const avatar = new File(['x'], 'a.png', { type: 'image/png' })
        await updatePlatformUser('u1', { name: 'Ada' }, { avatar })
        const body = api.request().body as FormData
        expect(body).toBeInstanceOf(FormData)
        expect(body.get('avatar')).toBeInstanceOf(File)
        expect(JSON.parse(String(body.get('@jsonPayload')))).toEqual({
            name: 'Ada',
        })
    })

    it('suspends and lifts through the suspension endpoint', async () => {
        await suspendUser('u1', { permanent: true, reason: 'spam' })
        expect(api.request()).toMatchObject({
            url: '/api/platform/users/u1/suspension',
            method: 'POST',
            body: { permanent: true, reason: 'spam' },
        })
        await liftSuspension('u1')
        expect(api.request()).toMatchObject({
            url: '/api/platform/users/u1/suspension',
            method: 'DELETE',
        })
    })

    it('grants and revokes platform admin rights', async () => {
        api.respond(apiUser)
        await grantPlatformAdmin('u1')
        expect(api.request()).toMatchObject({
            url: '/api/platform/admins',
            method: 'POST',
            body: { user: 'u1' },
        })
        await revokePlatformAdmin('u1')
        expect(api.request()).toMatchObject({
            url: '/api/platform/admins/u1',
            method: 'DELETE',
        })
    })
})

describe('platform stats and features', () => {
    it('runs the security actions on a user', async () => {
        await resetUserMfa('u1')
        expect(api.request()).toMatchObject({
            url: '/api/platform/users/u1/mfa',
            method: 'DELETE',
        })
        await revokeUserSessions('u1')
        expect(api.request()).toMatchObject({
            url: '/api/platform/users/u1/sessions',
            method: 'DELETE',
        })
        await clearUserLockout('u1')
        expect(api.request()).toMatchObject({
            url: '/api/platform/users/u1/lockout',
            method: 'DELETE',
        })
        await setUserPassword('u1', 'new-pass-123', 'new-pass-123')
        expect(api.request()).toMatchObject({
            url: '/api/platform/users/u1/password',
            method: 'POST',
            body: { password: 'new-pass-123', passwordConfirm: 'new-pass-123' },
        })
    })

    it('reads, saves and tests the mail settings', async () => {
        api.respond({ source: 'none' })
        expect(await getMailSettings()).toEqual({ source: 'none' })
        expect(api.request().url).toBe('/api/platform/mail')
        api.respond({ source: 'database' })
        await updateMailSettings({
            smtp_host: 'smtp.example.com',
            smtp_port: 587,
            smtp_username: '',
            smtp_tls: false,
            sender_address: 'a@example.com',
            sender_name: '',
        })
        expect(api.request()).toMatchObject({
            url: '/api/platform/mail',
            method: 'PUT',
            body: { smtp_host: 'smtp.example.com' },
        })
        await sendTestMail()
        expect(api.request()).toMatchObject({
            url: '/api/platform/mail/test',
            method: 'POST',
        })
    })

    it('reads server logs by level and changes the runtime level', async () => {
        api.respond({ replica: 'a', level: 'INFO', items: [] })
        await listServerLogs('warn')
        expect(api.request().url).toBe('/api/platform/logs?level=warn')
        api.respond({ level: 'debug' })
        await setLogLevel('debug')
        expect(api.request()).toMatchObject({
            url: '/api/platform/logs/level',
            method: 'PUT',
            body: { level: 'debug' },
        })
    })

    it('reads and saves sign-in providers', async () => {
        api.respond({ items: [{ provider: 'google' }] })
        expect(await listOAuthProviderSettings()).toEqual([
            { provider: 'google' },
        ])
        expect(api.request().url).toBe('/api/platform/oauth2')
        api.respond({ items: [] })
        await saveOAuthProviderSettings('google', {
            enabled: true,
            client_id: 'id',
            display_name: '',
            issuer_url: '',
            tenant: '',
            team_id: '',
            key_id: '',
        })
        expect(api.request()).toMatchObject({
            url: '/api/platform/oauth2/google',
            method: 'PUT',
            body: { client_id: 'id' },
        })
    })

    it('reads the per-gym stats', async () => {
        const stats = {
            gyms: [{ id: 'g1', members: 2, routes: 3 }],
            totals: {
                gyms: 1,
                active_gyms: 1,
                members: 2,
                routes: 3,
                users: 5,
            },
        }
        api.respond(stats)
        expect(await platformStats()).toEqual(stats)
        expect(api.request().url).toBe('/api/platform/stats')
    })

    it('loads traffic for a range', async () => {
        api.respond({ range: '7d' })
        expect(await getPlatformTraffic('7d')).toEqual({ range: '7d' })
        expect(api.request().url).toBe('/api/platform/traffic?range=7d')
    })

    it('loads the system state', async () => {
        api.respond({ version: 'dev' })
        expect(await getPlatformSystem()).toEqual({ version: 'dev' })
        expect(api.request().url).toBe('/api/platform/system')
    })

    it('lists the flag registry', async () => {
        api.respond({ flags: ['beta_links'] })
        expect(await listFeatureFlags()).toEqual({ flags: ['beta_links'] })
        expect(api.request().url).toBe('/api/platform/features')
    })

    it('replaces the flags of a gym', async () => {
        api.respond({ id: 'g1', features: { beta_links: true } })
        await setGymFeatures('g1', { beta_links: true })
        expect(api.request()).toMatchObject({
            url: '/api/platform/gyms/g1/features',
            method: 'PUT',
            body: { beta_links: true },
        })
    })
})
