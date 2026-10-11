import type { Locator } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { createRoute } from '../../support/api'
import { uiaa } from '../../support/seed'
import { gotoSettled, gymPath } from '../../support/nav'
import { seedMap, type SeededMap } from '../../support/map'

let seeded: SeededMap
let routeId: string

test.beforeEach(async ({ adminApi, testPrefix }) => {
    seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    const route = await createRoute(adminApi, {
        name: `${testPrefix}-summary`,
        ...uiaa('7'),
        location: seeded.locationId,
        wall: seeded.northWallId,
        wall_position: 0.8,
        type: 'Route',
        color: '#1E88E5',
        creator: ['E2E'],
        screw_date: new Date().toISOString().slice(0, 10),
    })
    routeId = route.id
    seeded.routeIds.push(route.id)
})

test.afterEach(async () => {
    await seeded.cleanup()
})

async function expectDotAndGrade(row: Locator) {
    const dot = row.getByTestId('route-color-dot')
    await expect(dot).toBeVisible()
    await expect(dot).toHaveCSS('background-color', 'rgb(30, 136, 229)')
    await expect(row.getByTestId('grade-label')).toContainText('7')
}

test('the route list shows the color dot and grade', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('filter-search').fill(`${testPrefix}-summary`)
    const row = page
        .getByRole('row')
        .filter({ has: page.getByTestId(`index-row-${routeId}`) })
    await expectDotAndGrade(row)
})

test('the map list shows the color dot and grade', async ({ page }) => {
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    const row = page.locator(
        `[data-testid="map-list-route"][data-route-id="${routeId}"]`,
    )
    await expectDotAndGrade(row)
})

test('the overview shows the color dot and grade for new routes', async ({
    page,
}) => {
    await gotoSettled(page, gymPath('/'))
    const tile = page.locator(
        `[data-testid="overview-new-route"][data-route-id="${routeId}"]`,
    )
    await expectDotAndGrade(tile)
})
