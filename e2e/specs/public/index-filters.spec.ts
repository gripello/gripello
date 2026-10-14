import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { uiaa } from '../../support/seed'

test('shows no rows for a search with no matches', async ({ page }) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('filter-search').fill('no-such-route-e2e-xyz')
    await expect(page.getByTestId('index-table')).not.toContainText(
        'e2e-route-',
    )
})

test('filters the route list by search text', async ({ page }) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('filter-search').fill('e2e-route-1')
    await expect(page.getByTestId('index-table')).toContainText('e2e-route-1')
})

test('filters by grade, and every visible row actually matches', async ({
    page,
    createRoute,
}) => {
    const five = await createRoute(uiaa('5'))
    const six = await createRoute(uiaa('6'))
    await gotoSettled(page, '/routes')
    await page.getByTestId('index-filter-difficulty').click()
    await page.getByRole('option', { name: '5 · UIAA', exact: true }).click()

    const table = page.getByTestId('index-table')
    await page
        .getByTestId('filter-search')
        .fill(five.name.replace(/-\d+$/, '-'))
    await expect(table.getByTestId(`index-row-${five.id}`)).toBeVisible()
    await expect(table.getByTestId(`index-row-${six.id}`)).toHaveCount(0)

    await page
        .getByTestId('index-filter-difficulty')
        .locator('[data-slot="trailingClear"]')
        .click()
    await expect(table.getByTestId(`index-row-${six.id}`)).toBeVisible()
})

test('matches every search word against name or setter', async ({
    page,
    createRoute,
    testPrefix,
}) => {
    const setter = `${testPrefix}-setter`
    const match = await createRoute({ creator: [setter] })
    const otherSetter = await createRoute({ creator: ['E2E'] })
    await gotoSettled(page, '/routes')
    await page.getByTestId('filter-search').fill(`${setter} ${match.name}`)

    const table = page.getByTestId('index-table')
    await expect(table.getByTestId(`index-row-${match.id}`)).toBeVisible()
    await expect(table.getByTestId(`index-row-${otherSetter.id}`)).toHaveCount(
        0,
    )
})

test('combines a route name with a signed grade', async ({
    page,
    createRoute,
}) => {
    const route = await createRoute(uiaa('6+'))

    await gotoSettled(page, '/routes')
    const search = page.getByTestId('filter-search')
    const exactRoute = page
        .getByTestId('index-table')
        .getByText(route.name, { exact: true })

    const level = route.grade.slice(0, -1)
    await search.fill(`${route.name} ${level}+`)
    await expect(exactRoute).toBeVisible()

    await search.fill(`${route.name} ${level}-`)
    await expect(exactRoute).toHaveCount(0)
})
