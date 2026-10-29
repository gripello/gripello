import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('a route change elsewhere keeps the visitor on their page', async ({
    page,
    testPrefix,
    createRoute,
}) => {
    for (let index = 0; index < 25; index++) await createRoute()

    await gotoSettled(page, '/routes')
    const range = page.getByTestId('index-table').getByTestId('table-page-info')
    await page.getByTestId('filter-search').fill(testPrefix)
    await expect(range).toContainText(/^\s*1\D.*\b25\s*$/)
    await page.getByRole('button', { name: /next page/i }).click()
    await expect(range).toContainText(/^\s*21\D.*\b25\s*$/)

    await createRoute()
    // the live list refetch is spread over 5–10 s
    await expect(range).toContainText(/^\s*21\D.*\b26\s*$/, {
        timeout: 15_000,
    })
})
