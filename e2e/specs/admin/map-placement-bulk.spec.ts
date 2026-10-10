import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { uiaa } from '../../support/seed'
import {
    archiveRoute,
    createRoute,
    getRoute,
    updateWall,
} from '../../support/api'
import { gotoSettled } from '../../support/nav'
import { seedMap, type SeededMap } from '../../support/map'

let seeded: SeededMap
let unplacedIds: string[]

test.beforeEach(async ({ testPrefix, adminApi }) => {
    seeded = await seedMap(adminApi, testPrefix, { routes: 3 })
    unplacedIds = []
    for (const [index, color] of ['#00ACC1', '#FB8C00'].entries()) {
        const route = await createRoute(adminApi, {
            name: `${testPrefix}-unplaced-${index + 1}`,
            ...uiaa('6'),
            location: seeded.locationId,
            anchor_point: 11 + index,
            type: 'Boulder',
            color,
            creator: ['E2E'],
            screw_date: '2026-09-01',
        })
        unplacedIds.push(route.id)
    }
    seeded.routeIds.push(...unplacedIds)
})

test.afterEach(async () => {
    await seeded.cleanup()
})

const wallOutline = (page: Page, name: string) =>
    page
        .locator(`[data-testid="placement-wall"][data-name="${name}"]`)
        .getByTestId('placement-wall-outline')

const listItem = (page: Page, id: string) =>
    page.locator(`[data-testid="placement-route"][data-route-id="${id}"]`)

async function saveAndReload(page: Page) {
    await page.getByTestId('placement-save').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        'Route positions saved',
    )
    return Promise.all(unplacedIds.map((id) => getRoute(seeded.api, id)))
}

test('auto-place puts routes on the wall that covers their anchor', async ({
    setterPage: page,
}) => {
    await updateWall(seeded.api, seeded.islandWallId, {
        anchor_from: 10,
        anchor_to: 20,
    })
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    const auto = page.getByTestId('placement-auto')
    await expect(auto).toContainText('2')
    await auto.click()
    await expect(auto).toBeDisabled()

    const [first, second] = await saveAndReload(page)
    expect(first!.wall).toBe(seeded.islandWallId)
    expect(second!.wall).toBe(seeded.islandWallId)
    expect(first!.wall_position).toBeLessThan(second!.wall_position!)
})

test('ticked routes are placed together with one tap on a wall', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    for (const id of unplacedIds)
        await listItem(page, id).getByTestId('placement-route-check').click()
    await expect(page.getByTestId('placement-checked')).toContainText('2')
    await wallOutline(page, `${testPrefix} North`).click()
    await expect(page.getByTestId('placement-checked')).toHaveCount(0)

    const placed = await saveAndReload(page)
    expect(placed.map((route) => route.wall)).toEqual([
        seeded.northWallId,
        seeded.northWallId,
    ])
})

test('after placing a route the next one is armed', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    await listItem(page, unplacedIds[0]!).click()
    await wallOutline(page, `${testPrefix} Island`).click()
    await expect(page.getByTestId('placement-hint')).toContainText(
        `${testPrefix}-unplaced-2`,
    )
    await page.getByTestId('placement-skip').click()
    await expect(page.getByTestId('placement-hint')).toContainText(
        `${testPrefix}-unplaced-2`,
    )
})

test('nudge buttons move the selected dot along its wall', async ({
    setterPage: page,
}) => {
    const routeId = seeded.routeIds[0]!
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    await page
        .locator(`[data-testid="placement-dot"][data-route-id="${routeId}"]`)
        .click()
    await page.getByTestId('placement-nudge-forward').click()
    await page.getByTestId('placement-save').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        'Route positions saved',
    )
    const saved = await getRoute(seeded.api, routeId)
    expect(saved.wall_position).toBe(0.27)
})

test('the colour filter narrows the route list', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    await page
        .getByTestId('placement-filters')
        .getByTestId('map-filter-color-chip')
        .click()
    await page
        .getByTestId('map-filter-color')
        .locator('[data-color="#00ACC1"]')
        .click()
    const items = page.getByTestId('placement-route')
    await expect(items).toHaveCount(1)
    await expect(items).toContainText(`${testPrefix}-unplaced-1`)
})

test('resetting a wall archives its routes', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    await wallOutline(page, `${testPrefix} North`).click()
    await expect(page.getByTestId('placement-wall-age')).toBeVisible()
    await page.getByTestId('placement-reset-wall').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        '2 routes archived',
    )
    const [first, second] = await Promise.all(
        seeded.routeIds.slice(0, 2).map((id) => getRoute(seeded.api, id)),
    )
    expect(first!.archived).toBe(true)
    expect(second!.archived).toBe(true)
    await expect(page.getByTestId('placement-wall-age')).toContainText(
        'last reset',
    )
})

test('routes not on the map are flagged on the routes page', async ({
    setterPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await expect(page.getByTestId('unplaced-banner')).toBeVisible()
    await page.getByTestId('unplaced-banner-open').click()
    await page.waitForURL(/\/manage\/map/)
})

test('the route page links an unplaced route straight to placement', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/route?id=${unplacedIds[0]}`)
    await page.getByTestId('route-place-on-map').click()
    await page.waitForURL(/\/manage\/map/)
    await expect(page.getByTestId('placement-hint')).toContainText(
        `${testPrefix}-unplaced-1`,
    )
})

test('the route form picks the wall from the anchor number', async ({
    adminPage: page,
    testPrefix,
}) => {
    await updateWall(seeded.api, seeded.islandWallId, {
        anchor_from: 30,
        anchor_to: 40,
    })
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-create-open').click()
    await page.getByTestId('route-form-location').click()
    await page
        .getByRole('option', { name: `${testPrefix} Map Hall`, exact: true })
        .click()
    await page.getByTestId('route-form-anchor-point').fill('35')
    await expect(page.getByTestId('route-form-wall')).toContainText(
        `${testPrefix} Island`,
    )
})

test('auto-place stays hidden while no wall has an anchor range', async ({
    setterPage: page,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    await expect(page.getByTestId('placement-route').first()).toBeVisible()
    await expect(page.getByTestId('placement-auto')).toHaveCount(0)
})

test('tapping an existing dot places the armed route next to it', async ({
    setterPage: page,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    await listItem(page, unplacedIds[0]!).click()
    await page
        .locator(
            `[data-testid="placement-dot"][data-route-id="${seeded.routeIds[0]}"]`,
        )
        .click()
    await expect(
        page.locator(
            `[data-testid="placement-dot"][data-route-id="${unplacedIds[0]}"]`,
        ),
    ).toBeVisible()
})

test('archived routes offer no placement from the route page', async ({
    setterPage: page,
}) => {
    await archiveRoute(seeded.api, unplacedIds[1]!)
    await gotoSettled(page, `/route?id=${unplacedIds[1]}`)
    await expect(page.getByTestId('route-page-name')).toBeVisible()
    await expect(page.getByTestId('route-place-on-map')).toHaveCount(0)
})
