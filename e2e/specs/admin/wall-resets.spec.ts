import { test, expect } from '../../support/fixtures'
import { gotoSettled, searchRoutes } from '../../support/nav'
import { seedMap } from '../../support/map'

test('setters plan route removals per wall, climbers see them, finishing archives them', async ({
    setterPage,
    userPage,
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 3 })
    const [kept, planned] = seeded.routeIds
    const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    try {
        await gotoSettled(
            setterPage,
            `/manage/map?location=${seeded.locationId}`,
        )
        await setterPage
            .locator(
                `[data-testid="placement-wall"][data-name="${testPrefix} North"]`,
            )
            .click()
        const planner = setterPage.getByTestId('wall-reset')
        await expect(
            planner.getByTestId(`reset-route-${planned}`),
        ).toBeVisible()
        await planner.getByTestId('reset-date').fill(day)
        await planner.getByTestId(`reset-route-${kept}`).click()
        await planner.getByTestId('reset-save').click()
        await expect(planner.getByTestId('reset-planned')).toHaveText(/· 1$/)

        await setterPage
            .locator(
                `[data-testid="placement-dot"][data-route-id="${planned}"]`,
            )
            .click()
        const details = setterPage.getByTestId('route-reset')
        await expect(details.getByTestId('route-reset-recent')).toContainText(
            '0',
        )
        await expect(details.getByTestId('route-reset-clear')).toBeVisible()

        await gotoSettled(userPage, '/routes')
        await searchRoutes(userPage, testPrefix)
        const outSoon = (id: string) =>
            userPage
                .locator(
                    `[data-testid="route-card-${id}"], [data-testid="index-row-${id}"]`,
                )
                .locator(
                    '[data-testid="route-card-out-soon"], [data-testid="index-row-out-soon"]',
                )
        await expect(outSoon(planned!)).toHaveCount(1)
        await expect(outSoon(kept!)).toHaveCount(0)

        await planner.getByTestId('reset-done').click()
        await setterPage.getByTestId('confirm-dialog-confirm').click()
        await expect(planner.getByTestId('reset-planned')).toHaveCount(0)
        await expect(outSoon(planned!)).toHaveCount(0)
    } finally {
        await seeded.cleanup()
    }
})
