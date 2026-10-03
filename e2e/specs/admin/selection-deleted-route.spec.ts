import PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { PB_URL } from '../../support/map'
import { authAsSuperuser, e2eGymId, uiaa } from '../../support/seed'

async function seedSite(prefix: string, routeCount: number) {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const location = await root
        .collection('locations')
        .create({ name: `${prefix}-hall`, gym: await e2eGymId(root) })
    const routeIds: string[] = []
    for (let index = 0; index < routeCount; index++) {
        const route = await root.collection('routes').create({
            name: `${prefix}-sel-${index}`,
            ...uiaa('5'),
            anchor_point: 1 + index,
            location: location.id,
            type: 'Route',
            creator: ['E2E'],
            color: '#F44336',
            screw_date: '2026-01-01',
        })
        routeIds.push(route.id)
    }
    return {
        root,
        locationName: location.name as string,
        routeIds,
        cleanup: async () => {
            for (const id of routeIds) {
                await root
                    .collection('routes')
                    .delete(id)
                    .catch(() => {})
            }
            await root
                .collection('locations')
                .delete(location.id)
                .catch(() => {})
        },
    }
}

test('a route deleted elsewhere drops out of the admin selection', async ({
    adminPage: page,
    testPrefix,
}) => {
    const site = await seedSite(testPrefix, 2)
    const [deletedId, keptId] = site.routeIds as [string, string]
    try {
        await gotoSettled(page, '/manage/routes')
        await page.getByTestId('filter-search').fill(`${testPrefix}-sel-`)
        await expect(page.getByTestId('routes-table')).toContainText(
            `${testPrefix}-sel-1`,
        )
        await page.getByTestId('routes-select-all').click()
        await expect(page.getByTestId('routes-select-all')).toContainText(
            '2 selected',
        )

        await site.root.collection('routes').delete(deletedId)
        await expect(page.getByTestId('routes-select-all')).toContainText(
            '1 selected',
        )

        await page.getByTestId('routes-archive-selected').click()
        await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
        await expect
            .poll(
                async () =>
                    (await site.root.collection('routes').getOne(keptId))
                        .archived,
            )
            .toBe(true)
    } finally {
        await site.cleanup()
    }
})

test('inventory archive recovers when a missing route was deleted meanwhile', async ({
    adminPage: page,
    testPrefix,
}) => {
    await page.addInitScript(() =>
        localStorage.setItem('inventory-instructions-seen', '1'),
    )
    const site = await seedSite(testPrefix, 3)
    const [deletedId, keptId, foundId] = site.routeIds as [
        string,
        string,
        string,
    ]
    try {
        await gotoSettled(page, '/manage/inventory')
        await page
            .getByTestId(`inventory-location-${site.locationName}`)
            .click()
        await page.getByTestId(`inventory-mark-${foundId}`).click()
        await page.getByTestId('inventory-finish-open').click()
        await expect(
            page.getByTestId(`inventory-archive-toggle-${deletedId}`),
        ).toBeVisible()

        await site.root.collection('routes').delete(deletedId)
        await page.getByTestId('inventory-finish-confirm').click()
        await expect(
            page.getByTestId(`inventory-archive-toggle-${deletedId}`),
        ).toHaveCount(0)

        await page.getByTestId('inventory-finish-confirm').click()
        await expect(page.getByTestId('inventory-finish-dialog')).toBeHidden()
        await expect
            .poll(
                async () =>
                    (await site.root.collection('routes').getOne(keptId))
                        .archived,
            )
            .toBe(true)
    } finally {
        await site.cleanup()
    }
})
