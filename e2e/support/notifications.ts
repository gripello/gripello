import { expect, type Page } from '@playwright/test'
import type PocketBase from 'pocketbase'
import { authHeader } from './nav'

export interface NotificationRecord {
    id: string
    type: string
    url: string
    params?: Record<string, unknown>
}

export async function waitForNotification(page: Page, marker: string) {
    const headers = await authHeader(page)
    let match: NotificationRecord | undefined
    await expect
        .poll(
            async () => {
                const res = await page.request.get(
                    '/api/collections/notifications/records?perPage=200&sort=-created',
                    { headers },
                )
                match = ((await res.json()).items ?? []).find(
                    (item: NotificationRecord) =>
                        JSON.stringify(item.params ?? {}).includes(marker),
                )
                return !!match
            },
            { message: `notification carrying ${marker}` },
        )
        .toBe(true)
    return match!
}

export function notificationsOf(
    root: PocketBase,
    userId: string,
    type: string,
) {
    return root.collection('notifications').getFullList<NotificationRecord>({
        filter: root.filter('user = {:user} && type = {:type}', {
            user: userId,
            type,
        }),
        sort: '-created',
        requestKey: null,
    })
}

export async function waitForNotificationOf(
    root: PocketBase,
    userId: string,
    type: string,
) {
    let found: NotificationRecord | undefined
    await expect
        .poll(
            async () => {
                found = (await notificationsOf(root, userId, type))[0]
                return !!found
            },
            { message: `${type} notification for ${userId}` },
        )
        .toBe(true)
    return found!
}

export async function openFromBell(page: Page, id: string) {
    await page.getByTestId('notification-bell').click()
    await page.getByTestId(`notification-item-${id}`).click()
}
