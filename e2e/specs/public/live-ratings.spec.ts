import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSubscribed, gymPath, searchRoutes } from '../../support/nav'
import { uiaa } from '../../support/seed'

function trackRefetches(page: Page) {
    const refetches: string[] = []
    page.on('request', (request) => {
        const url = request.url()
        if (
            url.includes('/api/collections/averageRating/') ||
            (url.includes('/api/collections/ratings/records') &&
                request.method() === 'GET')
        )
            refetches.push(url)
    })
    return refetches
}

test('a rating from another visitor updates the open route page in place', async ({
    page,
    root,
    route,
    testPrefix,
}) => {
    await gotoSubscribed(page, `/route?id=${route.id}`, 'ratings')
    const refetches = trackRefetches(page)

    const comment = `${testPrefix} live review`
    await root.collection('ratings').create({
        route_id: route.id,
        rating: 4,
        ...uiaa('5'),
        comment,
    })

    await expect(page.getByText(comment)).toBeVisible()
    await expect(page.getByTestId('route-avg-rating')).toContainText('4')
    expect(refetches).toEqual([])
})

test('a rating from another visitor updates the open overview in place', async ({
    page,
    root,
    route,
}) => {
    await root
        .collection('ratings')
        .create({ route_id: route.id, rating: 5, ...uiaa('5') })

    await gotoSubscribed(page, gymPath('/'), 'ratings')
    const popularRow = page.locator(
        `[data-testid="overview-popular"] [data-route-id="${route.id}"]`,
    )
    await expect(popularRow).toHaveCount(0)
    const refetches = trackRefetches(page)

    await root
        .collection('ratings')
        .create({ route_id: route.id, rating: 5, ...uiaa('5') })

    await expect(popularRow).toBeVisible()
    expect(refetches).toEqual([])
})

test('an edited route updates the open route list in place', async ({
    page,
    root,
    route,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await gotoSubscribed(page, '/routes', 'routes')
    await searchRoutes(page, route.name)
    const refetches = trackRefetches(page)

    const renamed = `${route.name} renamed`
    await root.collection('routes').update(route.id, { name: renamed })

    await expect(
        page.getByTestId(`index-row-${route.id}`).getByTestId('index-row-name'),
    ).toHaveText(renamed)
    expect(refetches).toEqual([])
})
