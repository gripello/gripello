import { test, expect } from '../../support/fixtures'
import { uiaa } from '../../support/seed'
import { createRoute, getRoute, updateRoute } from '../../support/api'
import { gotoSettled } from '../../support/nav'
import { seedMap, type SeededMap } from '../../support/map'

let seeded: SeededMap

test.beforeEach(async ({ testPrefix, adminApi }) => {
    seeded = await seedMap(adminApi, testPrefix, { routes: 2 })
})

test.afterEach(async () => {
    await seeded.cleanup()
})

test('map dots are focusable buttons named after route and colour', async ({
    page,
    testPrefix,
}) => {
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    const dot = page.locator(
        `[data-testid="map-route-dot"][data-route-id="${seeded.routeIds[0]}"]`,
    )
    await expect(dot).toHaveAttribute('role', 'button')
    await expect(dot).toHaveAttribute('tabindex', '0')
    await expect(dot).toHaveAttribute(
        'aria-label',
        `${testPrefix}-map-route-1, Red`,
    )
    await expect(dot.locator('title')).toHaveCount(0)

    await dot.focus()
    await page.keyboard.press('Enter')
    const card = page.getByTestId('map-route-card')
    await expect(card).toContainText(`${testPrefix}-map-route-1`)
    await expect(card.getByTestId('route-color-dot').first()).toHaveAttribute(
        'aria-label',
        'Red',
    )
})

test('placement walls and dots can be used with the keyboard', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    const wall = page.locator(
        `[data-testid="placement-wall"][data-name="${testPrefix} North"]`,
    )
    await expect(wall).toHaveAttribute('role', 'button')
    await expect(wall).toHaveAttribute('aria-label', `${testPrefix} North`)
    await wall.focus()
    await page.keyboard.press('Enter')
    await expect(wall).toHaveAttribute('aria-pressed', 'true')

    const dot = page.locator(
        `[data-testid="placement-dot"][data-route-id="${seeded.routeIds[1]}"]`,
    )
    await expect(dot).toHaveAttribute(
        'aria-label',
        `${testPrefix}-map-route-2, Blue`,
    )
    await dot.focus()
    await page.keyboard.press('Space')
    await expect(dot).toHaveAttribute('aria-pressed', 'true')
})

test('map dot names skip a missing colour', async ({ page, testPrefix }) => {
    await updateRoute(seeded.api, seeded.routeIds[0]!, { color: '' })
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    await expect(
        page.locator(
            `[data-testid="map-route-dot"][data-route-id="${seeded.routeIds[0]}"]`,
        ),
    ).toHaveAttribute('aria-label', `${testPrefix}-map-route-1`)
})

test('pressing Enter on a dot while a route is armed places it there', async ({
    setterPage: page,
    testPrefix,
}) => {
    const loose = await createRoute(seeded.api, {
        name: `${testPrefix}-loose`,
        ...uiaa('6'),
        location: seeded.locationId,
        type: 'Boulder',
        color: '#00ACC1',
        creator: ['E2E'],
        screw_date: '2026-09-01',
    })
    seeded.routeIds.push(loose.id)
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    await page
        .locator(`[data-testid="placement-route"][data-route-id="${loose.id}"]`)
        .click()
    await page
        .locator(
            `[data-testid="placement-dot"][data-route-id="${seeded.routeIds[0]}"]`,
        )
        .focus()
    await page.keyboard.press('Enter')

    await expect(
        page.locator(
            `[data-testid="placement-dot"][data-route-id="${loose.id}"]`,
        ),
    ).toBeVisible()
    await page.getByTestId('placement-save').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        'Route positions saved',
    )
    const saved = await getRoute(seeded.api, loose.id)
    expect(saved.wall).toBe(seeded.northWallId)
})

test('editor walls, shapes and points are keyboard reachable', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
    await expect(page.getByTestId('map-floor-shape').first()).toHaveAttribute(
        'aria-label',
        'Floor',
    )

    const wall = page.locator(
        `[data-testid="map-editor-wall"][data-name="${testPrefix} Island"]`,
    )
    await expect(wall).toHaveAttribute('tabindex', '0')
    await page.getByTestId('map-editor-tool-mat').click()
    await expect(wall).toHaveAttribute('tabindex', '-1')
    await expect(wall).not.toHaveAttribute('role', 'button')
    await page.getByTestId('map-editor-tool-select').click()
    await expect(wall).toHaveAttribute('tabindex', '0')
    await wall.focus()
    await page.keyboard.press('Space')
    await expect(wall).toHaveAttribute('aria-pressed', 'true')

    const firstPoint = page.getByTestId('map-editor-vertex').first()
    await expect(firstPoint).toHaveAttribute('aria-label', 'Point 1')
    await firstPoint.focus()
    await page.keyboard.press('Enter')
    await expect(firstPoint).toHaveAttribute('aria-pressed', 'true')

    const vertices = await page.getByTestId('map-editor-vertex').count()
    const midpoint = page.getByTestId('map-editor-midpoint').first()
    await expect(midpoint).toHaveAttribute('aria-label', 'Add point')
    await midpoint.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('map-editor-vertex')).toHaveCount(
        vertices + 1,
    )
})

test('clicking editor shapes and walls draws no browser focus ring', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
    const shape = page.getByTestId('map-floor-shape').first()
    await shape.click({ position: { x: 4, y: 4 } })
    await expect(shape).toHaveCSS('outline-style', 'none')

    const wall = page.locator(
        `[data-testid="map-editor-wall"][data-name="${testPrefix} Island"]`,
    )
    await wall.focus()
    await expect(wall).toHaveCSS('outline-style', 'none')
})
