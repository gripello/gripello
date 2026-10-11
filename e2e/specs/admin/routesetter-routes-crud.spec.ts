import { test, expect } from '../../support/fixtures'
import { uiaa } from '../../support/seed'
import { apiOf, gotoSettled } from '../../support/nav'
import { createRoute } from '../../support/api'

test('routesetter can create and delete a route (manage_routes permission)', async ({
    setterPage: page,
    testPrefix,
    workerLocation,
}) => {
    await gotoSettled(page, '/manage/routes')

    const name = `${testPrefix}-setter`

    await page.getByTestId('routes-create-open').click()
    await expect(page.getByTestId('route-form-dialog')).toBeVisible()
    await page.getByTestId('route-form-name').fill(name)
    await page.getByTestId('route-form-difficulty').click()
    await page.getByRole('option', { name: '5', exact: true }).click()
    await page.getByTestId('route-form-type').click()
    await page.getByRole('option', { name: 'Route', exact: true }).click()
    await page.getByTestId('route-form-anchor-point').fill('10')
    await page.getByTestId('route-form-location').click()
    await page
        .getByRole('option', { name: workerLocation.name, exact: true })
        .click()
    await expect(page.getByRole('listbox')).toBeHidden()
    await page.getByTestId('route-form-creator').fill('E2E Setter')
    await page.keyboard.press('Enter')
    await page.getByTestId('route-form-screw-date').fill('2026-01-01')
    await page.getByTestId('route-form-submit').click()
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    await page.getByTestId('filter-search').fill(name)
    await expect(page.getByTestId('routes-row-name')).toHaveText([name])

    await page.getByTestId('routes-row-edit').first().click()
    await page.getByTestId('route-form-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    await page.getByTestId('filter-search').fill(name)
    await expect(page.getByTestId('routes-table')).not.toContainText(name)
})

test('a user without manage_routes cannot reach or write to /manage/routes', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await page.waitForURL((url) => !url.pathname.endsWith('/manage/routes'))

    await expect(
        createRoute(await apiOf(page), {
            name: 'should-not-be-created-by-user',
            ...uiaa('1'),
        }),
    ).rejects.toMatchObject({ status: expect.any(Number) })
})
