import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

const horizontalOverflow = (page: Page) =>
    page.evaluate(() => {
        const el = document.documentElement
        return el.scrollWidth - el.clientWidth
    })

test('the role list never scrolls sideways on a small phone', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoSettled(page, '/admin/users#roles')

    const list = page.getByTestId('role-list')
    await expect(list).toBeVisible()
    await expect(page.getByTestId('role-detail')).toBeHidden()

    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1)
    await expect
        .poll(async () => {
            const box = (await list.boundingBox())!
            return box.x + box.width
        })
        .toBeLessThanOrEqual(375)
})

test('tapping a role opens its permissions full width and back returns to the list', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoSettled(page, '/admin/users#roles')

    await page.getByTestId('role-permissions-row-routesetter').click()
    const detail = page.getByTestId('role-detail')
    await expect(detail).toBeVisible()
    await expect(page.getByTestId('role-list')).toBeHidden()

    const toggle = page.getByTestId(
        'role-permissions-routesetter-view_analytics',
    )
    await toggle.scrollIntoViewIfNeeded()
    await expect
        .poll(async () => {
            const box = (await toggle.boundingBox())!
            return box.x >= 0 && box.x + box.width <= 375
        })
        .toBe(true)
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1)

    await page.getByTestId('role-detail-back').click()
    await expect(page.getByTestId('role-list')).toBeVisible()
    await expect(detail).toBeHidden()
})

test('the role create dialog opens as a bottom sheet on a phone', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoSettled(page, '/admin/users#roles')

    await page.getByTestId('role-create-open').click()
    await expect(page.getByTestId('role-form-dialog')).toBeVisible()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect
        .poll(async () => {
            const box = (await sheet.boundingBox())!
            return box.x <= 1 && box.width >= 374
        })
        .toBe(true)
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1)
})
