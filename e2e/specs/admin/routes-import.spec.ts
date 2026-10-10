import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import { E2E_GYM_SLUG, uiaa } from '../../support/seed'
import type { Api } from '../../support/api'
import type { RatingRecord } from '../../../types/models'
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

test('imports routes from a CSV file with a manual column mapping', async ({
    adminPage: page,
    testPrefix,
    workerLocation,
}, testInfo) => {
    const name = `${testPrefix}-csv`
    const file = testInfo.outputPath('import.csv')
    fs.writeFileSync(
        file,
        `Name;Grade;Type;Location;Schrauber\n${name};6b;Boulder;${workerLocation.name};CSV Setter\n`,
    )

    await gotoSettled(page, '/manage/routes')
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('routes-import-open').click()
    const chooser = await fileChooserPromise
    await chooser.setFiles(file)

    await expect(page.getByTestId('import-route-dialog')).toBeVisible()
    await page.getByTestId('import-route-map-creator').click()
    await page.getByRole('option', { name: 'Schrauber' }).click()
    await page.getByTestId('import-route-confirm').click()
    await expect(page.getByTestId('global-snackbar').last()).not.toContainText(
        /issues/i,
    )

    await page.getByTestId('filter-search').fill(name)
    await expect(page.getByTestId('routes-table')).toContainText('6B')
    await expect(page.getByTestId('routes-table')).toContainText('CSV Setter')
})

const ratingsMatching = (api: Api, q: string, query = {}) =>
    api.get<{ items: RatingRecord[]; total?: number }>(
        `/gyms/${E2E_GYM_SLUG}/ratings`,
        { q, ...query },
    )

async function chooseImportFile(
    page: Parameters<typeof gotoSettled>[0],
    file: string,
) {
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('routes-import-open').click()
    const chooser = await fileChooserPromise
    await chooser.setFiles(file)
    await expect(page.getByTestId('import-route-dialog')).toBeVisible()
}

test('imports reviews of an older system onto the routes imported before', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    workerLocation,
}, testInfo) => {
    const name = `${testPrefix}-legacy`
    const routesFile = testInfo.outputPath('routes.csv')
    const reviewsFile = testInfo.outputPath('reviews.csv')
    fs.writeFileSync(
        routesFile,
        `Old ID;Name;Grade;Type;Location\n${testPrefix}-17;${name};6b;Boulder;${workerLocation.name}\n`,
    )
    fs.writeFileSync(
        reviewsFile,
        `Route ID;Stars;Text;Date\n${testPrefix}-17;4;${name} first;2021-03-04 09:30:00Z\n${testPrefix}-17;5;${name} second;2022-05-06 10:00:00Z\nunknown;3;lost;2022-01-01\n`,
    )

    await gotoSettled(page, '/manage/routes')
    await chooseImportFile(page, routesFile)
    await page.getByTestId('import-route-confirm').click()
    await expect(page.getByTestId('import-route-dialog')).toBeHidden()

    await chooseImportFile(page, reviewsFile)
    await page.getByTestId('import-mode-reviews').click()
    await expect(page.getByTestId('import-review-count')).toContainText('2')
    await expect(page.getByTestId('import-review-row')).toHaveCount(3)
    await page.getByTestId('import-route-confirm').click()
    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        /without a route/i,
    )

    const { items: ratings } = await ratingsMatching(adminApi, name, {
        sort: 'oldest',
    })
    expect(
        ratings.map((rating) => [
            rating.comment,
            new Date(rating.created!).toISOString(),
        ]),
    ).toEqual([
        [`${name} first`, '2021-03-04T09:30:00.000Z'],
        [`${name} second`, '2022-05-06T10:00:00.000Z'],
    ])
    expect(ratings.every((rating) => !rating.author)).toBe(true)
})

test('keeps review dates of a Gripello JSON export', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    workerLocation,
}, testInfo) => {
    const name = `${testPrefix}-json-dates`
    const file = testInfo.outputPath('import.json')
    fs.writeFileSync(
        file,
        JSON.stringify([
            {
                name,
                ...uiaa('6'),
                location: workerLocation.name,
                type: 'Route',
                ratings: [
                    {
                        rating: 4,
                        comment: name,
                        created: '2020-02-03 04:05:06.000Z',
                    },
                ],
            },
        ]),
    )

    await gotoSettled(page, '/manage/routes')
    await chooseImportFile(page, file)
    await page.getByTestId('import-route-confirm').click()
    await expect(page.getByTestId('import-route-dialog')).toBeHidden()

    await expect
        .poll(async () =>
            (await ratingsMatching(adminApi, name)).items
                .filter((rating) => rating.comment === name)
                .map((rating) => new Date(rating.created!).toISOString()),
        )
        .toEqual(['2020-02-03T04:05:06.000Z'])
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
    await page.route(/\/api\/gyms\/[^/]+\/routes$/, (route) =>
        route.request().method() === 'POST'
            ? route.fulfill({ status: 500, body: 'boom' })
            : route.continue(),
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
    adminApi,
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
    const bulkImport = page.waitForResponse('**/api/gyms/*/ratings/import')
    await page.getByTestId('import-route-confirm').click()
    expect((await bulkImport).ok()).toBe(true)
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect(page.getByTestId('global-snackbar').last()).not.toContainText(
        /issues/i,
    )

    const ratings = await ratingsMatching(adminApi, name, {
        limit: 1,
        total: 'true',
    })
    expect(ratings.total).toBe(ratingCount)
})

test('only route managers may bulk import ratings', async ({
    userPage: page,
}) => {
    await gotoSettled(page, gymPath('/'))
    await expect(
        (await apiOf(page)).post(`/gyms/${E2E_GYM_SLUG}/ratings/import`, {
            ratings: [],
        }),
    ).rejects.toMatchObject({ status: 403 })
})
