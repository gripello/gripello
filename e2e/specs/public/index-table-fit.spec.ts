import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test.use({ viewport: { width: 1160, height: 900 } })

test('the route table fits without sideways scrolling', async ({ page }) => {
    await gotoSettled(page, '/routes')
    const container = page.getByTestId('index-table')
    const table = container.getByRole('table')
    await expect(table).toBeVisible()

    const containerWidth = (await container.boundingBox())!.width
    await expect
        .poll(async () => (await table.boundingBox())!.width)
        .toBeLessThanOrEqual(containerWidth + 1)
})

test('setter names keep clear of the row dividers', async ({
    page,
    createRoute,
}) => {
    const route = await createRoute({
        creator: ['E2E Setter With A Long Name', 'Second Long Setter Name'],
    })
    await gotoSettled(page, '/routes')
    await page.getByTestId('filter-search').fill(route.name)

    const row = page
        .getByRole('row')
        .filter({ has: page.getByTestId(`index-row-${route.id}`) })
    const setters = row.getByTestId('index-row-creators')
    await expect(setters).toHaveText(
        'E2E Setter With A Long Name, Second Long Setter Name',
    )

    const gaps = await row.evaluate((tr) => {
        const box = tr
            .querySelector('[data-testid="index-row-creators"]')!
            .getBoundingClientRect()
        const rect = tr.getBoundingClientRect()
        return { top: box.top - rect.top, bottom: rect.bottom - box.bottom }
    })
    expect(gaps.top).toBeGreaterThanOrEqual(4)
    expect(gaps.bottom).toBeGreaterThanOrEqual(4)
})
