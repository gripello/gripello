import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('selects filtered routes and archives them', async ({
    adminPage: page,
    createRoute,
    testPrefix,
}) => {
    await createRoute()
    await createRoute()

    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(testPrefix)
    await expect(page.getByTestId('routes-row-name')).toHaveCount(2)

    await page.getByTestId('routes-select-all').click()
    await page.getByTestId('routes-archive-selected').click()
    await page.getByTestId('confirm-dialog-confirm').click()

    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()

    await page.getByTestId('routes-filter-archived').click()
    await expect(page.getByTestId('routes-row-name')).toHaveCount(2)
})

test('hides the archive action when nothing is selected', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await expect(page.getByTestId('routes-archive-selected')).toHaveCount(0)
})

test('shows an error and keeps routes when archiving fails', async ({
    adminPage: page,
    createRoute,
    testPrefix,
}) => {
    await createRoute()
    await createRoute()

    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(testPrefix)
    await expect(page.getByTestId('routes-row-name')).toHaveCount(2)

    await page.route('**/api/gyms/*/routes/archive', (route) =>
        route.abort('failed'),
    )

    await page.getByTestId('routes-select-all').click()
    await page.getByTestId('routes-archive-selected').click()
    await page.getByTestId('confirm-dialog-confirm').click()

    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect(page.getByTestId('routes-row-name')).toHaveCount(2)
})
