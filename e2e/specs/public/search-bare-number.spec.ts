import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import {
    createRoute as createRouteVia,
    deleteRoute,
    ensureLocations,
    routeInput,
} from '../../support/api'

test('a number that is no grade searches route names', async ({
    page,
    adminApi,
    testPrefix,
}) => {
    const locations = await ensureLocations(adminApi)
    const digitFreePrefix = testPrefix.replace(
        /\d/g,
        (digit) => 'abcdefghij'[Number(digit)]!,
    )
    const createRoute = (name: string, screwDate: string) =>
        createRouteVia(
            adminApi,
            routeInput(name, locations['Hall A']!, { screw_date: screwDate }),
        )
    const matching = await createRoute(
        `zz97zz ${digitFreePrefix}`,
        '2099-01-01',
    )
    const other = await createRoute(`${digitFreePrefix} other`, '2099-01-02')
    try {
        await gotoSettled(page, '/routes')
        await page.getByTestId('filter-search').fill('97')
        await expect(page.getByTestId(`index-row-${matching.id}`)).toBeVisible()
        await expect(page.getByTestId(`index-row-${other.id}`)).toHaveCount(0)
    } finally {
        await deleteRoute(adminApi, matching.id)
        await deleteRoute(adminApi, other.id)
    }
})
