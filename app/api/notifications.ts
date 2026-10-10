import type {
    NotificationRecord,
    PushSubscriptionRecord,
    UserRecord,
} from '../../types/models'
import type {
    NotificationPrefs,
    NotificationTopic,
} from '../utils/notificationPrefs'
import { useAuthState } from './auth'
import { useApi } from './client'
import type { PageQuery, RouteList } from './client'

export interface NotificationQuery extends PageQuery {
    unread?: boolean
}

export type MarkReadRequest = { ids: string[] } | { all: true }

export interface NotificationSettings {
    enabled: boolean
    publicKey: string
    topics: NotificationTopic[]
}

export interface PushSubscriptionInput {
    endpoint: string
    p256dh: string
    auth: string
    device?: string
}

const MAX_NOTIFICATIONS = 200

export function listNotifications(
    query: NotificationQuery = {},
): Promise<RouteList<NotificationRecord>> {
    return useApi()<RouteList<NotificationRecord>>('/me/notifications', {
        query: {
            unread: query.unread || undefined,
            page: query.page,
            limit: query.limit ?? MAX_NOTIFICATIONS,
        },
    })
}

export async function markNotificationsRead(request: MarkReadRequest) {
    await useApi()('/me/notifications/read', { method: 'POST', body: request })
}

export function deleteNotification(id: string) {
    return useApi()(`/me/notifications/${id}`, { method: 'DELETE' })
}

export function getNotificationSettings() {
    return useApi()<NotificationSettings>('/notifications/settings')
}

export function getNotificationPrefs() {
    return useApi()<NotificationPrefs>('/me/notification-prefs')
}

export async function updateNotificationPrefs(
    prefs: NotificationPrefs,
): Promise<NotificationPrefs> {
    const updated = await useApi()<NotificationPrefs>(
        '/me/notification-prefs',
        { method: 'PUT', body: prefs },
    )
    const auth = useAuthState()
    const user = auth.currentUser<UserRecord>()
    if (user) auth.saveUser({ ...user, notification_prefs: updated } as never)
    return updated
}

export function listPushSubscriptions() {
    return useApi()<{ items: PushSubscriptionRecord[] }>(
        '/me/push-subscriptions',
    )
}

export function createPushSubscription(input: PushSubscriptionInput) {
    return useApi()<PushSubscriptionRecord>('/me/push-subscriptions', {
        method: 'POST',
        body: input,
    })
}

export function deletePushSubscription(id: string) {
    return useApi()(`/me/push-subscriptions/${id}`, { method: 'DELETE' })
}

export function sendTestPush(endpoint: string) {
    return useApi()('/me/push/test', { method: 'POST', body: { endpoint } })
}
