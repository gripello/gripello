import PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { authAsSuperuser, uiaa } from '../../support/seed'
import { gotoSettled, gymPath } from '../../support/nav'
import { PB_URL, seedMap, type SeededMap } from '../../support/map'

let seeded: SeededMap
let freshRouteId: string

test.beforeEach(async ({ testPrefix }) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    seeded = await seedMap(root, testPrefix, { routes: 2 })
    const fresh = await root.collection('routes').create({
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

test('the overview shows new routes and walls that lead to the map', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, gymPath('/'))
    await expect(page.getByTestId('overview-stats')).toBeVisible()

    const fresh = page.locator(
        `[data-testid="overview-new-route"][data-route-id="${freshRouteId}"]`,
    )
    await expect(fresh).toContainText(`${testPrefix}-fresh`)

    const wall = page.locator(
        `[data-testid="overview-wall"][data-name="${testPrefix} North"]`,
    )
    await expect(wall).toContainText('2')
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

test('hovering a grade bar shows its route count', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoSettled(page, gymPath('/'))
    const bar = page.getByTestId('overview-grade-bar').first()
    await bar.hover()
    await expect(
        page.locator('[data-slot="content"]', { hasText: /routes/ }),
    ).toBeVisible()
    await expect(bar).toHaveAccessibleDescription(/routes/)
})

test('grade bars share one baseline on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await gotoSettled(page, gymPath('/'))
    const bottoms = await page
        .getByTestId('overview-grades')
        .first()
        .getByTestId('overview-grade-fill')
        .evaluateAll((fills) =>
            fills.map((fill) => fill.getBoundingClientRect().bottom),
        )
    expect(bottoms.length).toBeGreaterThan(1)
    expect(
        Math.max(...bottoms) - Math.min(...bottoms),
        bottoms.join(', '),
    ).toBeLessThan(1)
})

test('guests get the public nav and an all-routes link', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoSettled(page, gymPath('/'))
    const nav = page.getByTestId('nav-desktop-links')
    await expect(nav.getByTestId('nav-link-map')).toBeVisible()
    await expect(nav.getByTestId('nav-link-routes')).toBeVisible()
    await expect(nav.getByTestId('nav-link-logbook')).toHaveCount(0)
    await expect(page.getByTestId('nav-login')).toBeVisible()

    await page.getByTestId('overview-all-routes').click()
    await page.waitForURL(/\/routes$/)
})

test('new routes appear on the overview without a reload', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, gymPath('/'))
    await expect(page.getByTestId('overview-stats')).toBeVisible()

    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const live = await root.collection('routes').create({
        name: `${testPrefix}-live`,
        ...uiaa('5'),
        location: seeded.locationId,
        type: 'Route',
        color: '#1E88E5',
        creator: ['E2E'],
        screw_date: new Date().toISOString().slice(0, 10),
    })
    seeded.routeIds.push(live.id)

    await expect(
        page.locator(
            `[data-testid="overview-new-route"][data-route-id="${live.id}"]`,
        ),
    ).toBeVisible()
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
    await page.getByTestId('route-back').click()
    await page.waitForURL(/\/routes$/)
})

test('a directly opened route page leads back to the route list', async ({
    page,
}) => {
    await gotoSettled(page, `/route?id=${freshRouteId}`)
    await page.getByTestId('route-back').click()
    await page.waitForURL(/\/routes$/)
})
