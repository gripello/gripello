import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { seedMap } from '../../support/map'

async function oneBackLeaves(page: Page, previous: string) {
    await page.goBack()
    await expect(page).toHaveURL(previous)
}

test('analytics filter changes take one back step to leave', async ({
    adminPage: page,
}) => {
    const previous = gymPath('/manage/routes')
    await gotoSettled(page, previous)
    await gotoSettled(page, gymPath('/manage/analytics'))
    for (const range of ['30d', '12m', 'all']) {
        await page.getByTestId(`analytics-range-${range}`).click()
        await page.waitForURL(new RegExp(`range=${range}`))
    }
    await page.getByTestId('analytics-filter-archived').click()
    await page.waitForURL(/archived=true/)

    await oneBackLeaves(page, previous)
})

test('map location and wall switches take one back step to leave', async ({
    page,
    adminApi,
    testPrefix,
}) => {
    const first = await seedMap(adminApi, `${testPrefix}-a`, { routes: 1 })
    const second = await seedMap(adminApi, `${testPrefix}-b`, { routes: 1 })
    try {
        await gotoSettled(page, gymPath('/routes'))
        await gotoSettled(
            page,
            `${gymPath('/map')}?location=${first.locationId}`,
        )
        await page
            .locator(
                `[data-testid="map-wall-label"][data-name="${testPrefix}-a North"]`,
            )
            .click()
        await page.waitForURL(new RegExp(`wall=${first.northWallId}`))

        await page.getByTestId('map-location').click()
        await page
            .getByRole('menuitemcheckbox', { name: `${testPrefix}-b Map Hall` })
            .click()
        await page.waitForURL(new RegExp(`location=${second.locationId}`))

        await oneBackLeaves(page, gymPath('/routes'))
    } finally {
        await first.cleanup()
        await second.cleanup()
    }
})

test('switching user admin tabs takes one back step to leave', async ({
    adminPage: page,
}) => {
    const previous = gymPath('/manage/routes')
    await gotoSettled(page, previous)
    await gotoSettled(page, gymPath('/admin/users'))
    const tabs = page.getByTestId('users-tabs')
    for (const name of [
        'Roles & permissions',
        'Members',
        'Roles & permissions',
    ]) {
        await tabs.getByRole('tab', { name }).click()
        await expect(tabs.getByRole('tab', { name })).toHaveAttribute(
            'aria-selected',
            'true',
        )
    }
    await expect(page).toHaveURL(/#roles$/)

    await oneBackLeaves(page, previous)
})

test('a linked server issue and log filters take one back step to leave', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/platform')
    await gotoSettled(page, '/platform/logs?issue=e2e-missing-issue')
    await page.getByTestId('platform-issues-range-7d').click()
    await page.getByTestId('platform-logs-filter-error').click()
    await page.getByTestId('platform-logs-filter-warn').click()
    await page.getByTestId('platform-logs-search').fill('realtime')
    await expect(page).toHaveURL(/\/platform\/logs\?issue=e2e-missing-issue$/)

    await oneBackLeaves(page, '/platform')
})
