import { expect, type Page } from '@playwright/test'
import type { NotificationRecord } from '../../types/models'
import { listNotifications } from './api'
import { apiOf } from './nav'

export async function waitForNotification(page: Page, marker: string) {
    const api = await apiOf(page)
    let match: NotificationRecord | undefined
    await expect
        .poll(
            async () =>
                !!(match = (await listNotifications(api)).find((item) =>
                    JSON.stringify(item.params ?? {}).includes(marker),
                )),
            { message: `notification carrying ${marker}` },
        )
        .toBe(true)
    return match!
}

export async function openFromBell(page: Page, id: string) {
    await page.getByTestId('notification-bell').click()
    await page.getByTestId(`notification-item-${id}`).click()
}
