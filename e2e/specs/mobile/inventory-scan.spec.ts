import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { e2eGymId } from '../../support/seed'

async function isArchived(page: Page, id: string) {
    const res = await page.request.get(`/api/collections/routes/records/${id}`)
    return (await res.json()).archived === true
}

async function seedSession(page: Page, location: string, ids: string[]) {
    await page.evaluate(
        ({ location: loc, ids: scanned }) => {
            localStorage.setItem(
                'inventory-scanned-route-ids',
                JSON.stringify({ v: 3, location: loc, ids: scanned }),
            )
            localStorage.setItem('inventory-instructions-seen', '1')
        },
        { location, ids },
    )
    await gotoSettled(page, '/manage/inventory')
    await expect(page.getByTestId('inventory-progress')).toBeVisible()
}

test('archives only the checked routes at the scanned location', async ({
    adminPage: page,
    root,
    createRoute,
    workerLocation,
    testPrefix,
}) => {
    const hallA = []
    for (let index = 0; index < 4; index++) hallA.push(await createRoute())
    const otherHall = await root
        .collection('locations')
        .create({ name: `${testPrefix} Other Hall`, gym: await e2eGymId(root) })
    const hallB = [await createRoute({ location: otherHall.id })]

    const missing = hallA.slice(-2)
    const scanned = hallA.slice(0, -2)
    await gotoSettled(page, '/manage/inventory')
    await seedSession(
        page,
        workerLocation.id,
        scanned.map((route) => route.id),
    )
    await expect(page.getByTestId('inventory-found-count')).toHaveText(
        String(scanned.length),
    )
    for (const route of missing) {
        await expect(
            page.getByTestId(`inventory-missing-${route.id}`),
        ).toBeVisible()
    }

    const [toArchive, toKeep] = missing

    await page.getByTestId('inventory-finish-open').click()
    const dialog = page.getByTestId('inventory-finish-dialog')
    await expect(dialog).toBeVisible()

    for (const route of hallB) {
        await expect(
            page.getByTestId(`inventory-archive-toggle-${route.id}`),
        ).toHaveCount(0)
    }

    await expect(
        page.locator('[data-testid^="inventory-archive-toggle-"]'),
    ).toHaveCount(2)
    await page.getByTestId(`inventory-archive-toggle-${toKeep.id}`).click()
    await expect(page.getByTestId('inventory-finish-confirm')).toHaveText(
        /Archive\s+1\b/,
    )

    await page.getByTestId('inventory-finish-confirm').click()
    await expect(dialog).toBeHidden()

    await expect.poll(() => isArchived(page, toArchive.id)).toBe(true)
    expect(await isArchived(page, toKeep.id)).toBe(false)
    expect(await isArchived(page, hallB[0]!.id)).toBe(false)
})

test('requires a location before scanning can start', async ({
    adminPage: page,
    workerLocation,
}) => {
    await gotoSettled(page, '/manage/inventory')
    await page.evaluate(() => {
        localStorage.removeItem('inventory-scanned-route-ids')
        localStorage.setItem('inventory-instructions-seen', '1')
    })
    await gotoSettled(page, '/manage/inventory')

    await expect(page.getByTestId('inventory-start')).toBeDisabled()
    await page.getByTestId(`inventory-location-${workerLocation.name}`).click()
    await expect(page.getByTestId('inventory-start')).toBeEnabled()
})

test('restores a legacy session and asks which location it belongs to', async ({
    adminPage: page,
    createRoute,
    workerLocation,
}) => {
    const hallA = [await createRoute(), await createRoute()]
    await gotoSettled(page, '/manage/inventory')
    await page.evaluate(
        (ids) => {
            localStorage.setItem(
                'inventory-scanned-route-ids',
                JSON.stringify(ids),
            )
            localStorage.setItem('inventory-instructions-seen', '1')
        },
        hallA.map((route) => route.id),
    )
    await gotoSettled(page, '/manage/inventory')
    await expect(page.getByTestId('inventory-progress')).toBeVisible()

    await expect(page.getByTestId('inventory-found-count')).toHaveText('0')
    await expect(page.getByTestId('inventory-missing-count')).toHaveText('0')
    await expect(page.getByTestId('inventory-start')).toBeDisabled()

    await page.getByTestId(`inventory-location-${workerLocation.name}`).click()

    await expect(page.getByTestId('inventory-found-count')).toHaveText('2')
    await expect
        .poll(async () =>
            page.evaluate(() =>
                JSON.parse(
                    localStorage.getItem('inventory-scanned-route-ids') || '{}',
                ),
            ),
        )
        .toMatchObject({ v: 3, location: workerLocation.id })
})
