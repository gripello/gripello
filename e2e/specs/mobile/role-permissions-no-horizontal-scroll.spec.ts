import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

const horizontalOverflow = (page: Page) =>
    page.evaluate(() => {
        const el = document.documentElement
        return el.scrollWidth - el.clientWidth
    })

test('the role permission editor never scrolls sideways on a small phone', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoSettled(page, '/admin/users')

    const grid = page.getByTestId('role-permissions-table')
    await expect(grid).toBeVisible()

    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1)
    await expect
        .poll(async () => {
            const box = (await grid.boundingBox())!
            return box.x + box.width
        })
        .toBeLessThanOrEqual(375)
})

test('every role card and its permission toggles stay reachable on a phone', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoSettled(page, '/admin/users')

    const cards = page.locator('[data-testid^="role-permissions-row-"]')
    await expect(
        page.getByTestId('role-permissions-row-routesetter'),
    ).toBeVisible()

    await expect(async () => {
        for (const card of await cards.all()) {
            const box = (await card.boundingBox())!
            expect(box.x).toBeGreaterThanOrEqual(0)
            expect(box.x + box.width).toBeLessThanOrEqual(375)
        }
    }).toPass()

    const toggle = page.getByTestId(
        'role-permissions-routesetter-view_analytics',
    )
    await toggle.scrollIntoViewIfNeeded()
    await expect
        .poll(async () => {
            const box = (await toggle.boundingBox())!
            return box.x + box.width
        })
        .toBeLessThanOrEqual(375)
})

test('the role create dialog opens as a bottom sheet on a phone', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoSettled(page, '/admin/users')

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
