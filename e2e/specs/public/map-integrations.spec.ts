import PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { authAsSuperuser, e2eGym } from '../../support/seed'
import { authHeader, gotoSettled } from '../../support/nav'
import { PB_URL, seedMap, type SeededMap } from '../../support/map'

let seeded: SeededMap

test.beforeEach(async ({ testPrefix }) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    seeded = await seedMap(root, testPrefix, { routes: 3 })
})

test.afterEach(async () => {
    await seeded.cleanup()
})

test('the route list filters by wall and shows the wall column', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('index-filter-location').click()
    await page
        .getByRole('option', { name: `${testPrefix} Map Hall`, exact: true })
        .click()
    await page.getByTestId('index-filter-wall').click()
    await page
        .getByRole('option', { name: `${testPrefix} Island`, exact: true })
        .click()
    const table = page.getByTestId('index-table')
    await expect(table).toContainText(`${testPrefix}-map-route-3`)
    await expect(table).not.toContainText(`${testPrefix}-map-route-1`)
    await expect(table).toContainText(`${testPrefix} Island`)
})

test('the route page names the wall and links to it on the map', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, `/route?id=${seeded.routeIds[0]}`)
    await expect(page.getByTestId('route-wall')).toContainText(
        `${testPrefix} North`,
    )
    await page.getByTestId('route-show-on-map').click()
    await page.waitForURL(/\/map\?/)
    await expect(page).toHaveURL(new RegExp(`route=${seeded.routeIds[0]}`))
    await expect(page.getByTestId('map-route-card')).toContainText(
        `${testPrefix}-map-route-1`,
    )
})

test('the JSON export carries the wall', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/routes')
    const response = await page.request.post('/api/ui/json', {
        headers: await authHeader(page),
        data: { gym: await e2eGym(), ids: [seeded.routeIds[0]] },
    })
    expect(response.ok()).toBe(true)
    const [route] = await response.json()
    expect(route.wall).toBe(`${testPrefix} North`)
    expect(route.wall_position).toBe(0.25)
})
