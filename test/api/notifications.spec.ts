import { beforeEach, describe, expect, it } from 'vitest'
import {
    createPushSubscription,
    deleteNotification,
    deletePushSubscription,
    getNotificationPrefs,
    getNotificationSettings,
    listNotifications,
    listPushSubscriptions,
    markNotificationsRead,
    sendTestPush,
    updateNotificationPrefs,
} from '~/api/notifications'
import { useAuthState } from '~/api/auth'
import { ApiError } from '~/api/client'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
    useAuthState().saveAuth({
        token: 'token',
        record: { id: 'me', notification_prefs: {} } as never,
    })
})

function calls() {
    return api.fetchMock.mock.calls.map((_, index) => {
        const { url, method, body } = api.request(index)
        return [method, url, body]
    })
}

describe('notifications', () => {
    it('lists the bell', async () => {
        api.respond({ items: [{ id: 'n1' }], page: 1, limit: 200, total: 1 })
        expect((await listNotifications()).items).toEqual([{ id: 'n1' }])
        await listNotifications({ unread: true, page: 2, limit: 10 })
        expect(calls()).toEqual([
            ['GET', '/api/me/notifications?limit=200', undefined],
            [
                'GET',
                '/api/me/notifications?unread=true&page=2&limit=10',
                undefined,
            ],
        ])
    })

    it('marks read in one call and deletes one', async () => {
        await markNotificationsRead({ ids: ['n1', 'n2'] })
        await markNotificationsRead({ all: true })
        await deleteNotification('n1')
        expect(calls()).toEqual([
            ['POST', '/api/me/notifications/read', { ids: ['n1', 'n2'] }],
            ['POST', '/api/me/notifications/read', { all: true }],
            ['DELETE', '/api/me/notifications/n1', undefined],
        ])
    })
})

describe('settings and prefs', () => {
    it('reads the push settings', async () => {
        const settings = {
            enabled: true,
            publicKey: 'key',
            topics: [{ key: 'tasks' }],
        }
        api.respond(settings)
        expect(await getNotificationSettings()).toEqual(settings)
        expect(api.request().url).toBe('/api/notifications/settings')
    })

    it('reads and replaces the opt-outs and updates the auth record', async () => {
        api.respond({ push: { tasks: false } })
        expect(await getNotificationPrefs()).toEqual({ push: { tasks: false } })
        const prefs = { push: { social: false } }
        api.respond(prefs)
        expect(await updateNotificationPrefs(prefs)).toEqual(prefs)
        expect(calls()).toEqual([
            ['GET', '/api/me/notification-prefs', undefined],
            ['PUT', '/api/me/notification-prefs', prefs],
        ])
        expect(useAuthState().currentUser()).toMatchObject({
            id: 'me',
            notification_prefs: prefs,
        })
    })
})

describe('push subscriptions', () => {
    it('lists, subscribes and removes devices', async () => {
        api.respond({ items: [{ id: 'd1' }] })
        expect(await listPushSubscriptions()).toEqual({ items: [{ id: 'd1' }] })
        const input = {
            endpoint: 'https://push/e',
            p256dh: 'p',
            auth: 'a',
            device: 'Phone',
        }
        await createPushSubscription(input)
        await deletePushSubscription('d1')
        expect(calls()).toEqual([
            ['GET', '/api/me/push-subscriptions', undefined],
            ['POST', '/api/me/push-subscriptions', input],
            ['DELETE', '/api/me/push-subscriptions/d1', undefined],
        ])
    })

    it('sends a test push and surfaces a disabled push service', async () => {
        await sendTestPush('https://push/e')
        expect(calls()).toEqual([
            ['POST', '/api/me/push/test', { endpoint: 'https://push/e' }],
        ])
        api.respond(
            { status: 503, message: 'Push is not configured.', data: {} },
            503,
        )
        const error = await sendTestPush('https://push/e').catch((err) => err)
        expect(error).toBeInstanceOf(ApiError)
        expect(error.message).toBe('Push is not configured.')
    })
})
