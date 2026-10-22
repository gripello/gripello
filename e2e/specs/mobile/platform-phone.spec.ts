import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test.beforeEach(async ({ platformPage }) => {
    await platformPage.setViewportSize({ width: 390, height: 844 })
})

test('More keeps its tab active on the ops pages it lists', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/platform')
    await page.getByTestId('bottom-nav-platform-more').click()
    await expect(page).toHaveURL(/\/platform\/more$/)

    await page.getByTestId('platform-more-platform-logs').click()
    await expect(page).toHaveURL(/\/platform\/logs$/)
    await expect(page.getByTestId('bottom-nav-platform-more')).toHaveClass(
        /is-active/,
    )
})

test('settings drill into one section and keep unsaved changes', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/platform/settings')
    await expect(page.getByTestId('platform-settings-form')).toBeHidden()

    await page.getByTestId('platform-settings-drill-access').click()
    const retention = page.getByTestId('platform-settings-audit-retention')
    await expect(retention).toBeVisible()
    const original = await retention.inputValue()
    await retention.fill(String(Number(original) + 1))

    await page.getByTestId('nav-back').click()
    await expect(
        page.getByTestId('platform-settings-drill-access'),
    ).toBeVisible()
    await expect(page.getByTestId('platform-settings-unsaved')).toBeVisible()
    await page.getByTestId('platform-settings-cancel').click()
    await expect(page.getByTestId('platform-settings-unsaved')).toBeHidden()
})
