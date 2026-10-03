import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import { E2E_GYM_SLUG, ensureUser, getRoleIds, uiaa } from '../../support/seed'

test.use({
    launchOptions: { args: ['--ignore-certificate-errors'] },
    serviceWorkers: 'allow',
})

test('an ascent logged offline syncs when the connection returns', async ({
    page,
    root,
    testPrefix,
    workerLocation,
}) => {
    const roleIds = await getRoleIds(root)
    const climber = await ensureUser(root, roleIds.user, 'user', testPrefix)
    const route = await root.collection('routes').create({
        name: `${testPrefix}-offline-route`,
        ...uiaa('6'),
        location: workerLocation.id,
        type: 'Route',
        color: '#2196F3',
        creator: ['E2E'],
        screw_date: '2026-09-01',
    })
    const routeUrl = `/${E2E_GYM_SLUG}/route?id=${route.id}`

    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, routeUrl)
    await page.waitForFunction(
        () => navigator.serviceWorker?.controller !== null,
    )
    await gotoSettled(page, '/logbook')
    await expect(page.getByTestId('logbook-empty')).toBeVisible()
    await gotoSettled(page, routeUrl)

    await page.context().setOffline(true)
    await page.getByTestId('tick-open').click()
    await page.getByTestId('tick-type-flash').click()
    await page.getByTestId('tick-submit').click()
    await expect(page.getByTestId('route-ticked')).toBeVisible()

    await page.getByTestId('bottom-nav-logbook').click()
    await page.waitForURL('**/logbook')
    const pending = page.getByTestId('logbook-tick-pending')
    await expect(pending).toBeVisible()

    await page.context().setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect
        .poll(async () => {
            const result = await root.collection('ticks').getList(1, 1, {
                filter: `route = "${route.id}"`,
            })
            return result.totalItems
        })
        .toBe(1)
    await expect(pending).toHaveCount(0)
    await expect(
        page.getByTestId('logbook-tick').filter({ hasText: route.name }),
    ).toBeVisible()
})
