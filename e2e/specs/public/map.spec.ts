import PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { authAsSuperuser, e2eGymId } from '../../support/seed'
import { gotoSettled } from '../../support/nav'
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

test('shows every route as a dot in its hold colour', async ({ page }) => {
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    const dots = page.getByTestId('map-route-dot')
    await expect(dots).toHaveCount(3)
    await expect(
        page.locator(
            `[data-testid="map-route-dot"][data-route-id="${seeded.routeIds[0]}"]`,
        ),
    ).toHaveAttribute('data-color', '#E53935')
    await expect(page.getByTestId('map-wall')).toHaveCount(2)
})

test('tapping a wall focuses it and lists only its routes', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    await page
        .locator(
            `[data-testid="map-wall-label"][data-name="${testPrefix} North"]`,
        )
        .click()
    await expect(page).toHaveURL(new RegExp(`wall=${seeded.northWallId}`))
    await expect(
        page.locator(
            `[data-testid="map-wall"][data-name="${testPrefix} North"]`,
        ),
    ).toHaveAttribute('aria-pressed', 'true')

    const sheet = page.getByTestId('map-list')
    await expect(sheet.getByTestId('map-list-route')).toHaveCount(2)
    await expect(sheet).toContainText(`${testPrefix}-map-route-1`)
    await expect(sheet).not.toContainText(`${testPrefix}-map-route-3`)
})

test('a deep link to a route opens its card', async ({ page, testPrefix }) => {
    await gotoSettled(
        page,
        `/map?location=${seeded.locationId}&route=${seeded.routeIds[2]}`,
    )
    await expect(page.getByTestId('map-route-card')).toContainText(
        `${testPrefix}-map-route-3`,
    )
    await page.getByTestId('map-route-card-close').click()
    await expect(page.getByTestId('map-route-card')).toHaveCount(0)
})

test('tapping a dot opens the route card', async ({ page, testPrefix }) => {
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    await page
        .locator(
            `[data-testid="map-route-dot"][data-route-id="${seeded.routeIds[1]}"]`,
        )
        .click()
    await expect(page.getByTestId('map-route-card')).toContainText(
        `${testPrefix}-map-route-2`,
    )
})

test('a filter dims the routes that do not match', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    await page
        .getByTestId('map-filter-search')
        .fill(`${testPrefix}-map-route-2`)
    await expect(
        page.locator('[data-testid="map-route-dot"][data-dimmed]'),
    ).toHaveCount(2)
    await expect(page.getByTestId('map-list')).toContainText('1')
})

test('the colour filter dims routes in other colours', async ({ page }) => {
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    await page.getByTestId('map-filter-color-chip').click()
    await page
        .getByTestId('map-filter-color')
        .locator('[data-color="#E53935"]')
        .click()
    await expect(
        page.locator('[data-testid="map-route-dot"][data-dimmed]'),
    ).toHaveCount(2)
})

test('a location without a floor plan points to the list', async ({
    page,
    testPrefix,
}) => {
    const plain = await seeded.root.collection('locations').create({
        name: `${testPrefix} No Map`,
        gym: await e2eGymId(seeded.root),
    })
    try {
        await gotoSettled(page, `/map?location=${plain.id}`)
        await expect(page.getByTestId('map-empty')).toBeVisible()
    } finally {
        await seeded.root.collection('locations').delete(plain.id)
    }
})

test('on desktop the list sits next to the map, not over it', async ({
    page,
}) => {
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    const list = (await page.getByTestId('map-list').boundingBox())!
    const map = (await page.getByTestId('map-svg').boundingBox())!
    expect(list.x).toBeGreaterThanOrEqual(map.x + map.width - 1)
    await expect(page.getByTestId('map-sheet-handle')).toHaveCount(0)

    await page
        .locator(
            `[data-testid="map-list-route"][data-route-id="${seeded.routeIds[2]}"]`,
        )
        .click()
    await expect(page).toHaveURL(new RegExp(`route=${seeded.routeIds[2]}`))
})

test('the boulder chip hides routes of the other type', async ({ page }) => {
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    await expect(page.getByTestId('map-route-dot')).toHaveCount(3)
    await page.getByTestId('map-type-Route').click()
    await expect(page.getByTestId('map-type-Route')).toHaveAttribute(
        'aria-pressed',
        'true',
    )
    await expect(page.getByTestId('map-route-dot')).toHaveCount(0)
    await page.getByTestId('map-filter-clear').click()
    await expect(page.getByTestId('map-route-dot')).toHaveCount(3)
})
