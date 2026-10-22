import { test, expect } from '../../support/fixtures'
import { createRoute } from '../../support/api'
import { uiaa } from '../../support/seed'
import { gotoSettled, gymPath, pageBack } from '../../support/nav'
import { seedMap, type SeededMap } from '../../support/map'

let seeded: SeededMap
let freshRouteId: string

test.beforeEach(async ({ adminApi, testPrefix }) => {
    seeded = await seedMap(adminApi, testPrefix, { routes: 2 })
    const fresh = await createRoute(adminApi, {
        name: `${testPrefix}-fresh`,
        ...uiaa('6'),
        location: seeded.locationId,
        wall: seeded.northWallId,
        wall_position: 0.9,
        type: 'Route',
        color: '#8E24AA',
        creator: ['E2E'],
        screw_date: new Date().toISOString().slice(0, 10),
    })
    freshRouteId = fresh.id
    seeded.routeIds.push(fresh.id)
})

test.afterEach(async () => {
    await seeded.cleanup()
})

test('walls flag new routes and lead to the map', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, gymPath('/'))

    const wall = page.locator(
        `[data-testid="overview-wall"][data-name="${testPrefix} North"]`,
    )
    await expect(wall.getByTestId('overview-wall-new')).toBeVisible()
    await wall.click()
    await page.waitForURL(new RegExp(`/map\\?.*wall=${seeded.northWallId}`))
})

test('signed-in climbers see how many current routes they have sent', async ({
    userPage: page,
}) => {
    await gotoSettled(page, gymPath('/'))
    await expect(page.getByTestId('overview-progress')).toBeVisible()
})

test('guests are invited to sign in for the logbook', async ({ page }) => {
    await gotoSettled(page, gymPath('/'))
    await expect(page.getByTestId('overview-progress')).toHaveCount(0)
    await page.getByTestId('overview-login').click()
    await page.waitForURL(/\/auth\/login\?redirect=(%2F|\/)logbook/)
})

test('guests get the public nav and an all-routes link', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoSettled(page, gymPath('/'))
    const nav = page.getByTestId('nav-desktop-links')
    await expect(nav.getByTestId('nav-link-map')).toBeVisible()
    await expect(nav.getByTestId('nav-link-routes')).toBeVisible()
    await expect(nav.getByTestId('nav-link-logbook')).toHaveCount(0)
    await expect(
        page
            .getByTestId('nav-login')
            .or(page.getByTestId('sidebar-login'))
            .filter({ visible: true }),
    ).toBeVisible()

    await page.getByTestId('overview-all-routes').click()
    await page.waitForURL(/\/routes$/)
})

test('new routes appear on their wall without a reload', async ({
    page,
    adminApi,
    testPrefix,
}) => {
    await gotoSettled(page, gymPath('/'))
    const count = page
        .locator(
            `[data-testid="overview-wall"][data-name="${testPrefix} North"]`,
        )
        .getByTestId('overview-wall-count')
    const before = await count.innerText()

    const live = await createRoute(adminApi, {
        name: `${testPrefix}-live`,
        ...uiaa('5'),
        location: seeded.locationId,
        wall: seeded.northWallId,
        wall_position: 0.5,
        type: 'Route',
        color: '#1E88E5',
        creator: ['E2E'],
        screw_date: new Date().toISOString().slice(0, 10),
    })
    seeded.routeIds.push(live.id)

    await expect(count).not.toHaveText(before)
})

test('the route page leads back to where it was opened', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('filter-search').fill(`${testPrefix}-fresh`)
    await expect(page.getByTestId('route-view')).toHaveCount(1)
    await page.getByTestId('route-view').first().click()
    await page.waitForURL(/\/route\?id=/)
    await pageBack(page).click()
    await page.waitForURL(/\/routes$/)
})

test('a directly opened route page leads back to the route list', async ({
    page,
}) => {
    await gotoSettled(page, `/route?id=${freshRouteId}`)
    await pageBack(page).click()
    await page.waitForURL(/\/routes$/)
})
