import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled } from '../../support/nav'
import { E2E_GYM_SLUG } from '../../support/seed'
import { createLocation, deleteRoute } from '../../support/api'

const locationRow = (page: Page, name: string) =>
    page.locator(`[data-testid="settings-location"][data-name="${name}"]`)

test('admins add, rename and delete locations used by the route form', async ({
    adminPage: page,
    testPrefix,
}) => {
    const name = `${testPrefix} Hall`
    const renamed = `${testPrefix} Wall`

    await gotoSettled(page, '/admin/settings?section=locations')
    await page.getByTestId('settings-location-new').fill(name)
    await page.getByTestId('settings-location-add').click()
    await expect(locationRow(page, name)).toHaveCount(1)

    const renameSaved = page.waitForResponse(
        (response) =>
            response.request().method() === 'PATCH' &&
            /\/api\/locations\/[^/]+$/.test(response.url()),
    )
    await locationRow(page, name)
        .getByTestId('settings-location-name')
        .fill(renamed)
    await page.keyboard.press('Enter')
    expect((await renameSaved).ok()).toBe(true)
    await expect(locationRow(page, renamed)).toHaveCount(1)

    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-create-open').click()
    await page.getByTestId('route-form-location').click()
    await expect(
        page.getByRole('option', { name: renamed, exact: true }),
    ).toBeVisible()

    await gotoSettled(page, '/admin/settings?section=locations')
    await locationRow(page, renamed)
        .getByTestId('settings-location-delete')
        .click()
    await expect(locationRow(page, renamed)).toHaveCount(0)
})

test('a location that still has routes cannot be deleted', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    createRoute,
}) => {
    const name = `${testPrefix} Busy`
    const location = await createLocation(adminApi, name)
    const route = await createRoute({ location: location.id })

    await gotoSettled(page, '/admin/settings?section=locations')
    const row = locationRow(page, name)
    await row.getByTestId('settings-location-delete').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        /cannot be deleted/,
    )
    await expect(row).toHaveCount(1)

    await deleteRoute(adminApi, route.id)
    await row.getByTestId('settings-location-delete').click()
    await expect(row).toHaveCount(0)
})

test('only settings managers may change locations', async ({
    setterPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    const response = await page.request.post(
        `/api/gyms/${E2E_GYM_SLUG}/locations`,
        { headers: await authHeader(page), data: { name: 'Setter Hall' } },
    )
    expect(response.status()).toBe(403)
})
