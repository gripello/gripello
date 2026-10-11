import { beforeEach, describe, expect, it } from 'vitest'
import {
    deletePlatformUser,
    getPlatformStats,
    getPlatformUser,
    grantPlatformAdmin,
    liftSuspension,
    listFeatureFlags,
    listPlatformUsers,
    revokePlatformAdmin,
    setGymFeatures,
    suspendUser,
    updatePlatformUser,
} from '~/api/platform'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

const apiUser = {
    id: 'u1',
    email: 'ada@example.com',
    memberships: [{ id: 'm1', gym: 'g1', role: 'r1' }],
}

const platformUser = {
    id: 'u1',
    email: 'ada@example.com',
    expand: {
        memberships_via_user: [{ id: 'm1', user: 'u1', gym: 'g1', role: 'r1' }],
    },
}

beforeEach(() => {
    api = mockApi()
})

describe('platform users', () => {
    it('pages a search with memberships shaped like membership records', async () => {
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
        expect(await getPlatformStats()).toEqual(stats)
        expect(api.request().url).toBe('/api/platform/stats')
    })

    it('lists the flag registry', async () => {
        api.respond({ flags: ['beta_videos'] })
        expect(await listFeatureFlags()).toEqual({ flags: ['beta_videos'] })
        expect(api.request().url).toBe('/api/platform/features')
    })

    it('replaces the flags of a gym', async () => {
        api.respond({ id: 'g1', features: { beta_videos: true } })
        await setGymFeatures('g1', { beta_videos: true })
        expect(api.request()).toMatchObject({
            url: '/api/platform/gyms/g1/features',
            method: 'PUT',
            body: { beta_videos: true },
        })
    })
})
