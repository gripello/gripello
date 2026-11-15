import { test, expect } from '../../support/fixtures'
import {
    ApiError,
    createRating,
    getRoute,
    listRouteRatings,
    listRoutes,
} from '../../support/api'
import { gotoSettled, reloadSettled } from '../../support/nav'

// Catches: a create/edit/delete that only updates the table locally but never reaches the database.
test('creates, edits, and deletes a route', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    workerLocation,
}) => {
    await gotoSettled(page, '/manage/routes')

    const name = `${testPrefix}-crud`

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
    await expect
        .poll(async () => (await listRoutes(adminApi, { q: name })).length)
        .toBe(1)

    await page.getByTestId('routes-row-edit').first().click()
    await expect(page.getByTestId('route-form-dialog')).toBeVisible()
    await page.getByTestId('route-form-delete').click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await page.getByTestId('confirm-dialog-cancel').click()
    await expect(page.getByTestId('confirm-dialog')).toBeHidden()
    await expect(page.getByTestId('route-form-dialog')).toBeVisible()

    await page.getByTestId('route-form-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    await expect
        .poll(async () => (await listRoutes(adminApi, { q: name })).length)
        .toBe(0)
    await reloadSettled(page)
    await page.getByTestId('filter-search').fill(name)
    await expect(page.getByTestId('routes-table')).not.toContainText(name)
})

// Catches: client validation skipped or bypassed, posting a half-filled route.
test('blocks route creation when required fields are empty', async ({
    adminPage: page,
    adminApi,
    testPrefix,
}) => {
    await gotoSettled(page, '/manage/routes')
    const name = `${testPrefix}-invalid`

    await page.getByTestId('routes-create-open').click()
    await expect(page.getByTestId('route-form-dialog')).toBeVisible()
    await page.getByTestId('route-form-name').fill(name)
    const posts: string[] = []
    page.on('request', (request) => {
        if (request.method() === 'POST' && /\/routes$/.test(request.url()))
            posts.push(request.url())
    })
    await page.getByTestId('route-form-submit').click()

    await expect(page.getByTestId('route-form-type')).toHaveAttribute(
        'aria-invalid',
        'true',
    )
    await expect(
        page
            .getByTestId('route-form-dialog')
            .getByText('This field is required.'),
    ).not.toHaveCount(0)
    await expect(page.getByTestId('route-form-name')).not.toHaveAttribute(
        'aria-invalid',
        'true',
    )
    expect(posts).toEqual([])
    expect(await listRoutes(adminApi, { q: name })).toEqual([])
})

// Catches: one confirm silently deleting a route together with its reviews (data loss).
test('deleting a reviewed route asks again before the reviews go', async ({
    adminPage: page,
    adminApi,
    route,
}) => {
    await createRating(adminApi, route.id, { comment: 'keep me' })

    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(route.name)
    await expect(page.getByTestId('routes-row-name')).toHaveText([route.name])
    await page.getByTestId('routes-row-edit').click()
    await page.getByTestId('route-form-delete').click()

    await test.step('first confirm is refused and warns about history', async () => {
        const refused = page.waitForResponse(
            (response) =>
                response.request().method() === 'DELETE' &&
                response.url().includes(`/routes/${route.id}`),
        )
        await page.getByTestId('confirm-dialog-confirm').click()
        expect((await refused).status()).toBe(409)
        await expect(page.getByTestId('confirm-dialog')).toContainText(
            'This route has reviews',
        )
        await expect(page.getByTestId('route-form-dialog')).toBeVisible()
        expect((await getRoute(adminApi, route.id)).id).toBe(route.id)
        expect(await listRouteRatings(adminApi, route.id)).toHaveLength(1)
    })

    await test.step('second confirm deletes route and reviews', async () => {
        await page.getByTestId('confirm-dialog-confirm').click()
        await expect(page.getByTestId('route-form-dialog')).toBeHidden()
        const missing = await getRoute(adminApi, route.id).catch((e) => e)
        expect(missing).toBeInstanceOf(ApiError)
        expect((missing as ApiError).status).toBe(404)
        await reloadSettled(page)
        await page.getByTestId('filter-search').fill(route.name)
        await expect(page.getByTestId('routes-table')).not.toContainText(
            route.name,
        )
    })
})
