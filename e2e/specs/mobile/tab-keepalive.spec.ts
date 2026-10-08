import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { seedMap } from '../../support/map'
import { signInAs } from '../../support/auth'
import { ensureUser, getRoleIds, uiaa } from '../../support/seed'

test('switching tabs back to the map reuses its loaded routes', async ({
    userPage: page,
    root,
    testPrefix,
}) => {
    const seeded = await seedMap(root, testPrefix, { routes: 2 })
    try {
        await gotoSettled(page, `/map?location=${seeded.locationId}`)
        await expect(page.getByTestId('map-svg')).toBeVisible()

        const routeRequests: string[] = []
        page.on('request', (request) => {
            if (request.url().includes('/api/collections/averageRating/'))
                routeRequests.push(request.url())
        })

        await page.getByTestId('bottom-nav-logbook').click()
        await page.waitForURL('**/logbook')
        await page.goBack()
        await page.waitForURL('**/map?location=*')

        await expect(page.getByTestId('map-svg')).toBeVisible()
        expect(routeRequests).toEqual([])
    } finally {
        await seeded.cleanup()
    }
})

test('an ascent logged on the route shows up in the open logbook tab', async ({
    page,
    root,
    testPrefix,
    workerLocation,
}) => {
    const roleIds = await getRoleIds(root)
    const climber = await ensureUser(root, roleIds.user, 'user', testPrefix)
    const route = await root.collection('routes').create({
        name: `${testPrefix}-keepalive-route`,
        ...uiaa('6+'),
        location: workerLocation.id,
        type: 'Route',
        color: '#2196F3',
        creator: ['E2E'],
        screw_date: '2026-09-01',
    })

    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, `/route?id=${route.id}`)
    await page.getByTestId('bottom-nav-logbook').click()
    await page.waitForURL('**/logbook')
    await expect(page.getByTestId('logbook-empty')).toBeVisible()

    await page.goBack()
    await page.waitForURL('**/route?id=*')
    await page.getByTestId('tick-open').click()
    await page.getByTestId('tick-type-flash').click()
    await page.getByTestId('tick-submit').click()
    await expect(page.getByTestId('route-ticked')).toBeVisible()

    await page.getByTestId('bottom-nav-logbook').click()
    await page.waitForURL('**/logbook')
    await expect(
        page.getByTestId('logbook-tick').filter({ hasText: route.name }),
    ).toBeVisible()
})
