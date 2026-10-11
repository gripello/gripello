import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSubscribed, gymPath, searchRoutes } from '../../support/nav'
import { createRating, updateRoute } from '../../support/api'

// Other workers share the gym and trigger list refreshes, so refetches hang instead of being counted.
function stallRefetches(page: Page) {
    return page.route(
        (url) =>
            /\/api\/(gyms\/[^/]+\/(routes|ratings)|routes\/[^/]+(\/ratings)?)$/.test(
                url.pathname,
            ),
        (route) => {
            if (route.request().method() !== 'GET') return route.fallback()
        },
    )
}

test('a rating from another visitor updates the open route page in place', async ({
    page,
    adminApi,
    route,
    testPrefix,
}) => {
    await gotoSubscribed(page, `/route?id=${route.id}`, 'gym_changes:')
    await stallRefetches(page)

    const comment = `${testPrefix} live review`
    await createRating(adminApi, route.id, { rating: 4, comment })

    await expect(page.getByText(comment)).toBeVisible()
    await expect(page.getByTestId('route-avg-rating')).toContainText('4')
})

test('a rating from another visitor updates the open overview in place', async ({
    page,
    adminApi,
    route,
}) => {
    await createRating(adminApi, route.id, { rating: 5 })

    await gotoSubscribed(page, gymPath('/'), 'gym_changes:')
    const popularRow = page.locator(
        `[data-testid="overview-popular"] [data-route-id="${route.id}"]`,
    )
    await expect(popularRow).toHaveCount(0)
    await stallRefetches(page)

    await createRating(adminApi, route.id, { rating: 5 })

    await expect(popularRow).toBeVisible()
})

test('an edited route updates the open route list in place', async ({
    page,
    adminApi,
    route,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await gotoSubscribed(page, '/routes', 'gym_changes:')
    await searchRoutes(page, route.name)
    await stallRefetches(page)

    const renamed = `${route.name} renamed`
    await updateRoute(adminApi, route.id, { name: renamed })

    await expect(
        page.getByTestId(`index-row-${route.id}`).getByTestId('index-row-name'),
    ).toHaveText(renamed)
})
