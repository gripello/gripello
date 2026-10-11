import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { uiaa } from '../../support/seed'
import { createRoute, getRoute } from '../../support/api'
import { gotoSettled } from '../../support/nav'
import { seedMap, type SeededMap } from '../../support/map'

let seeded: SeededMap
let looseRouteId: string

test.beforeEach(async ({ testPrefix, adminApi }) => {
    seeded = await seedMap(adminApi, testPrefix, { routes: 3 })
    const loose = await createRoute(adminApi, {
        name: `${testPrefix}-loose`,
        ...uiaa('6'),
        location: seeded.locationId,
        type: 'Boulder',
        color: '#00ACC1',
        creator: ['E2E'],
        screw_date: '2026-09-01',
    })
    looseRouteId = loose.id
    seeded.routeIds.push(loose.id)
})

test.afterEach(async () => {
    await seeded.cleanup()
})

const wall = (page: Page, name: string) =>
    page.locator(`[data-testid="placement-wall"][data-name="${name}"]`)

async function clickInside(target: Locator) {
    await target.getByTestId('placement-wall-outline').click()
}

test('setters place an unplaced route by clicking it and then a wall', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    const item = page.locator(
        `[data-testid="placement-route"][data-route-id="${looseRouteId}"]`,
    )
    await expect(item).toBeVisible()
    await item.click()
    await expect(page.getByTestId('placement-hint')).toContainText(
        `${testPrefix}-loose`,
    )
    await clickInside(wall(page, `${testPrefix} Island`))

    await expect(
        page.locator(
            `[data-testid="placement-dot"][data-route-id="${looseRouteId}"]`,
        ),
    ).toBeVisible()
    await page.getByTestId('placement-save').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        'Route positions saved',
    )

    const saved = await getRoute(seeded.api, looseRouteId)
    expect(saved.wall).toBe(seeded.islandWallId)
    expect(saved.wall_position).toBeGreaterThan(0)
})

test('dragging a route from the list into a wall places it on that wall', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    const item = page.locator(
        `[data-testid="placement-route"][data-route-id="${looseRouteId}"]`,
    )
    const from = (await item.boundingBox())!
    const island = (await wall(page, `${testPrefix} Island`).boundingBox())!
    await page.mouse.move(from.x + 20, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(
        island.x + island.width / 2,
        island.y + island.height / 2,
        { steps: 12 },
    )
    await expect(page.getByTestId('placement-drag-ghost')).toBeVisible()
    await expect(page.getByTestId('placement-ghost')).toBeVisible()
    await page.mouse.up()

    await expect(page.getByTestId('placement-drag-ghost')).toHaveCount(0)
    await expect(
        page.locator(
            `[data-testid="placement-dot"][data-route-id="${looseRouteId}"]`,
        ),
    ).toBeVisible()
    await page.getByTestId('placement-save').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        'Route positions saved',
    )
    const saved = await getRoute(seeded.api, looseRouteId)
    expect(saved.wall).toBe(seeded.islandWallId)
})

test('dragging a dot onto another wall moves the route there', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    const islandRoute = seeded.routeIds[2]!
    const dot = page.locator(
        `[data-testid="placement-dot"][data-route-id="${islandRoute}"]`,
    )
    const from = (await dot.boundingBox())!
    const north = (await wall(page, `${testPrefix} North`).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(
        north.x + north.width / 2,
        north.y + north.height - 2,
        {
            steps: 10,
        },
    )
    await expect(page.getByTestId('placement-ghost')).toBeVisible()
    await page.mouse.up()

    await page.getByTestId('placement-save').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        'Route positions saved',
    )
    const saved = await getRoute(seeded.api, islandRoute)
    expect(saved.wall).toBe(seeded.northWallId)
})

test('selecting a dot on the map shows its route in the placed list', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    const routeId = seeded.routeIds[2]!
    await page
        .locator(`[data-testid="placement-dot"][data-route-id="${routeId}"]`)
        .click()

    await expect(
        page
            .getByRole('tab')
            .filter({ has: page.getByTestId('placement-tab-placed') }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('placement-selected')).toContainText(
        `${testPrefix}-map-route-3`,
    )
    await expect(
        page.locator(
            `[data-testid="placement-route"][data-route-id="${routeId}"]`,
        ),
    ).toBeInViewport()
})

test('a placed dot can be dragged along its wall', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    const routeId = seeded.routeIds[0]!
    const dot = page.locator(
        `[data-testid="placement-dot"][data-route-id="${routeId}"]`,
    )
    const from = (await dot.boundingBox())!
    const north = (await wall(page, `${testPrefix} North`).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(
        north.x + north.width * 0.9,
        north.y + north.height / 2,
        { steps: 10 },
    )
    await expect(page.getByTestId('placement-ghost')).toBeVisible()
    await page.mouse.up()
    await expect(page.getByTestId('placement-ghost')).toHaveCount(0)

    await page.getByTestId('placement-save').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        'Route positions saved',
    )
    const saved = await getRoute(seeded.api, routeId)
    expect(saved.wall).toBe(seeded.northWallId)
    expect(saved.wall_position).toBeGreaterThan(0.8)
})

test('routes on a wall can be spread evenly and the change undone', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    await wall(page, `${testPrefix} North`).click()
    await expect(page.getByTestId('placement-wall-box')).toContainText(
        `${testPrefix} North`,
    )
    await page.getByTestId('placement-distribute').click()
    await expect(page.getByTestId('placement-save')).toBeEnabled()
    await page.getByTestId('placement-undo').click()
    await expect(page.getByTestId('placement-save')).toBeDisabled()

    await page.getByTestId('placement-distribute').click()
    await page.getByTestId('placement-save').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        'Route positions saved',
    )
    const [first, second] = await Promise.all(
        seeded.routeIds.slice(0, 2).map((id) => getRoute(seeded.api, id)),
    )
    expect(first!.wall_position).toBe(0.25)
    expect(second!.wall_position).toBe(0.75)
})

test('the route form offers the walls of the chosen location', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(`${testPrefix}-loose`)
    await expect(page.getByTestId('routes-row-name')).toHaveText([
        `${testPrefix}-loose`,
    ])
    await page.getByTestId('routes-row-edit').first().click()
    await page.getByTestId('route-form-wall').click()
    await page
        .getByRole('option', { name: `${testPrefix} North`, exact: true })
        .click()
    await page.getByTestId('route-form-submit').click()
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    const saved = await getRoute(seeded.api, looseRouteId)
    expect(saved.wall).toBe(seeded.northWallId)
    expect(saved.wall_position).toBe(0.75)
})

test('climbers cannot open the placement page', async ({ userPage: page }) => {
    await gotoSettled(page, '/manage/map')
    await expect(page).not.toHaveURL(/\/manage\/map/)
})
