import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { seedMap } from '../../support/map'

test('logging an ascent from the map updates the wall counter', async ({
    userPage: page,
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 3 })
    try {
        await gotoSettled(page, `/map?location=${seeded.locationId}`)
        const northLabel = page.locator(
            `[data-testid="map-wall-label"][data-name="${testPrefix} North"]`,
        )
        await expect(northLabel.getByTestId('map-wall-count')).toHaveText('0/2')

        await page
            .locator(
                `[data-testid="map-route-dot"][data-route-id="${seeded.routeIds[0]}"]`,
            )
            .click()
        await page.getByTestId('map-log-ascent').click()
        await page.getByTestId('tick-type-flash').click()
        await page.getByTestId('tick-submit').click()

        await expect(northLabel.getByTestId('map-wall-count')).toHaveText('1/2')
        await expect(
            page.locator(
                `[data-testid="map-route-dot"][data-route-id="${seeded.routeIds[0]}"]`,
            ),
        ).toHaveAttribute('data-sent', 'true')

        await page.getByTestId('map-filter-unsent').click()
        await expect(
            page.locator('[data-testid="map-route-dot"][data-dimmed]'),
        ).toHaveCount(1)
    } finally {
        await seeded.cleanup()
    }
})
