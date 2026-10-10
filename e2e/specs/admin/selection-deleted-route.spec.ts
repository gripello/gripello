import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import {
    createLocation,
    createRoute,
    deleteRoute,
    getRoute,
    routeInput,
    type Api,
} from '../../support/api'

async function seedSite(api: Api, prefix: string, routeCount: number) {
    const location = await createLocation(api, `${prefix}-hall`)
    const routeIds: string[] = []
    for (let index = 0; index < routeCount; index++) {
        const route = await createRoute(
            api,
            routeInput(`${prefix}-sel-${index}`, location.id, {
                anchor_point: 1 + index,
                screw_date: '2026-01-01',
            }),
        )
        routeIds.push(route.id)
    }
    return { locationName: location.name, routeIds }
}

test('a route deleted elsewhere drops out of the admin selection', async ({
    adminPage: page,
    adminApi,
    testPrefix,
}) => {
    const site = await seedSite(adminApi, testPrefix, 2)
    const [deletedId, keptId] = site.routeIds as [string, string]
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(`${testPrefix}-sel-`)
    await expect(page.getByTestId('routes-table')).toContainText(
        `${testPrefix}-sel-1`,
    )
    await page.getByTestId('routes-select-all').click()
    await expect(page.getByTestId('routes-select-all')).toContainText(
        '2 selected',
    )

    await deleteRoute(adminApi, deletedId)
    await expect(page.getByTestId('routes-select-all')).toContainText(
        '1 selected',
    )

    await page.getByTestId('routes-archive-selected').click()
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect
        .poll(async () => (await getRoute(adminApi, keptId)).archived)
        .toBe(true)
})

test('inventory archive recovers when a missing route was deleted meanwhile', async ({
    adminPage: page,
    adminApi,
    testPrefix,
}) => {
    await page.addInitScript(() =>
        localStorage.setItem('inventory-instructions-seen', '1'),
    )
    const site = await seedSite(adminApi, testPrefix, 3)
    const [deletedId, keptId, foundId] = site.routeIds as [
        string,
        string,
        string,
    ]
    await gotoSettled(page, '/manage/inventory')
    await page.getByTestId(`inventory-location-${site.locationName}`).click()
    await page.getByTestId(`inventory-mark-${foundId}`).click()
    await page.getByTestId('inventory-finish-open').click()
    await expect(
        page.getByTestId(`inventory-archive-toggle-${deletedId}`),
    ).toBeVisible()

    await deleteRoute(adminApi, deletedId)
    await page.getByTestId('inventory-finish-confirm').click()
    await expect(
        page.getByTestId(`inventory-archive-toggle-${deletedId}`),
    ).toHaveCount(0)

    await page.getByTestId('inventory-finish-confirm').click()
    await expect(page.getByTestId('inventory-finish-dialog')).toBeHidden()
    await expect
        .poll(async () => (await getRoute(adminApi, keptId)).archived)
        .toBe(true)
})
