import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled, gymPath } from '../../support/nav'
import { uiaa } from '../../support/seed'
import fs from 'node:fs'

test('imports routes from a JSON file', async ({
    adminPage: page,
    testPrefix,
    workerLocation,
}, testInfo) => {
    const name = `${testPrefix}-import`
    const file = testInfo.outputPath('import.json')
    fs.writeFileSync(
        file,
        JSON.stringify([
            {
                name,
                difficulty: 8,
                difficulty_sign: null,
                anchor_point: 8,
                location: workerLocation.name.toUpperCase(),
                type: 'Boulder',
                comment: 'imported by e2e',
                creator: ['E2E Importer'],
                screw_date: '2026-01-01',
                color: '#2196F3',
                archived: false,
                ratings: [],
            },
        ]),
    )

    await gotoSettled(page, '/manage/routes')
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('routes-import-open').click()
    const chooser = await fileChooserPromise
    await chooser.setFiles(file)

    await expect(page.getByTestId('import-route-dialog')).toBeVisible()
    await page.getByTestId('import-route-confirm').click()
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()

    await page.getByTestId('filter-search').fill(name)
    await expect(page.getByTestId('routes-table')).toContainText(name)
    await expect(page.getByTestId('routes-table')).toContainText(
        workerLocation.name,
    )
    await expect(page.getByTestId('routes-table')).toContainText('6B')
})

test('reports import issues when route creation fails server-side', async ({
    adminPage: page,
    testPrefix,
    workerLocation,
}, testInfo) => {
    const name = `${testPrefix}-import-fail`
    const file = testInfo.outputPath('import.json')
    fs.writeFileSync(
        file,
        JSON.stringify([
            {
                name,
                ...uiaa('6'),
                location: workerLocation.name,
                type: 'Boulder',
                creator: ['E2E Importer'],
                screw_date: '2026-01-01',
                ratings: [],
            },
        ]),
    )

    await gotoSettled(page, '/manage/routes')
    await page.route('**/api/collections/routes/records', (route) =>
        route.fulfill({ status: 500, body: 'boom' }),
    )

    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('routes-import-open').click()
    const chooser = await fileChooserPromise
    await chooser.setFiles(file)

    await expect(page.getByTestId('import-route-dialog')).toBeVisible()
    await page.getByTestId('import-route-confirm').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        /issues/i,
    )
})

test('rejects a malformed JSON file', async ({ adminPage: page }, testInfo) => {
    const file = testInfo.outputPath('import.json')
    fs.writeFileSync(file, '{ not valid json ]')

    await gotoSettled(page, '/manage/routes')
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('routes-import-open').click()
    const chooser = await fileChooserPromise
    await chooser.setFiles(file)

    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect(page.getByTestId('import-route-dialog')).toBeHidden()
})

test('imports more ratings than the per-user rating rate limit', async ({
    adminPage: page,
    root,
    testPrefix,
    workerLocation,
}, testInfo) => {
    const name = `${testPrefix}-import-many`
    const ratingCount = 70
    const file = testInfo.outputPath('import.json')
    fs.writeFileSync(
        file,
        JSON.stringify([
            {
                name,
                ...uiaa('6'),
                location: workerLocation.name,
                type: 'Route',
                creator: ['E2E Importer'],
                screw_date: '2026-01-01',
                ratings: Array.from({ length: ratingCount }, (_, index) => ({
                    rating: 1 + (index % 5),
                    ...uiaa('6'),
                    comment: `${name} rating ${index}`,
                })),
            },
        ]),
    )

    await gotoSettled(page, '/manage/routes')
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('routes-import-open').click()
    const chooser = await fileChooserPromise
    await chooser.setFiles(file)
    const bulkImport = page.waitForResponse('**/api/import/ratings')
    await page.getByTestId('import-route-confirm').click()
    expect((await bulkImport).ok()).toBe(true)
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect(page.getByTestId('global-snackbar').last()).not.toContainText(
        /issues/i,
    )

    const ratings = await root.collection('ratings').getList(1, 1, {
        filter: root.filter('route_id.name = {:name}', { name }),
    })
    expect(ratings.totalItems).toBe(ratingCount)
})

test('only route managers may bulk import ratings', async ({
    userPage: page,
}) => {
    await gotoSettled(page, gymPath('/'))
    const response = await page.request.post('/api/import/ratings', {
        headers: await authHeader(page),
        data: { ratings: [] },
    })
    expect(response.status()).toBe(403)
})
