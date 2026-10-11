import { test, expect } from '../../support/fixtures'
import { updateRoute } from '../../support/api'
import { gotoSettled } from '../../support/nav'

test('puts route details beside the reviews under a full-width hero', async ({
    page,
    route,
}) => {
    await gotoSettled(page, `/route?id=${route.id}`)

    const hero = (await page.getByTestId('route-hero').boundingBox())!
    const details = (await page.getByTestId('route-details').boundingBox())!
    const reviews = (await page.getByTestId('route-reviews').boundingBox())!

    expect(hero.width).toBeGreaterThan(details.width * 2)
    expect(details.y).toBeGreaterThanOrEqual(hero.y + hero.height - 1)
    expect(reviews.x).toBeGreaterThanOrEqual(details.x + details.width)
})

test('keeps the grade badge and a long name clear of the stats card', async ({
    page,
    adminApi,
    route,
}) => {
    await updateRoute(adminApi, route.id, {
        name: 'Eckenflitzer mit sehr langem Routennamen am Überhang',
    })
    await page.setViewportSize({ width: 1024, height: 800 })
    await gotoSettled(page, `/route?id=${route.id}`)

    const stats = (await page.getByTestId('route-stats').boundingBox())!
    for (const testId of ['route-grade-badge', 'route-page-name']) {
        const box = (await page.getByTestId(testId).boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(stats.x)
    }
})
