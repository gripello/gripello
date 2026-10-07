import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('changing the route filter clears the selection', async ({
    adminPage: page,
    createRoute,
    testPrefix,
}) => {
    for (const name of [
        `${testPrefix}-a-0`,
        `${testPrefix}-a-1`,
        `${testPrefix}-b-0`,
    ]) {
        await createRoute({ name })
    }

    await gotoSettled(page, '/manage/routes')
    const search = page.getByTestId('filter-search')
    const selectAll = page.getByTestId('routes-select-all')

    await search.fill(`${testPrefix}-a`)
    await expect(page.getByTestId('routes-row-name')).toHaveCount(2)
    await selectAll.click()
    await expect(selectAll).toHaveText('2 selected')

    await search.fill(`${testPrefix}-b`)
    await expect(page.getByTestId('routes-row-name')).toHaveCount(1)
    await expect(selectAll).toHaveText('Select all')
    await expect(page.getByTestId('routes-archive-selected')).toHaveCount(0)

    await selectAll.click()
    await expect(selectAll).toHaveText('1 selected')
    await expect(selectAll).toHaveAttribute('title', 'Deselect all')
})
