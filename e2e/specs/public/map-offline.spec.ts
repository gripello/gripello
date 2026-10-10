import { test, expect } from '../../support/fixtures'
import { seedMap } from '../../support/map'

test.use({
    launchOptions: { args: ['--ignore-certificate-errors'] },
    serviceWorkers: 'allow',
})

test('the map opens from cache when the network is gone', async ({
    page,
    adminApi,
    context,
    testPrefix,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 3 })
    try {
        await page.goto(`/map?location=${seeded.locationId}`)
        await page.waitForFunction(
            () => navigator.serviceWorker?.controller !== null,
        )
        await page.reload()
        await expect(page.getByTestId('map-route-dot')).toHaveCount(3)

        await context.setOffline(true)
        await page.reload()
        await expect(page.getByTestId('map-page')).toBeVisible()
        await expect(page.getByTestId('map-route-dot')).toHaveCount(3)
    } finally {
        await context.setOffline(false)
        await seeded.cleanup()
    }
})
