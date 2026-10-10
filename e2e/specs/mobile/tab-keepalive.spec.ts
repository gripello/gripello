import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { seedMap } from '../../support/map'
import { signInAs } from '../../support/auth'
import { uiaa } from '../../support/seed'

test('switching tabs back to the map reuses its loaded routes', async ({
    userPage: page,
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 2 })
    try {
        await gotoSettled(page, `/map?location=${seeded.locationId}`)
        await expect(page.getByTestId('map-svg')).toBeVisible()

        const routeRequests: string[] = []
        page.on('request', (request) => {
            const url = new URL(request.url())
            if (
                /\/api\/gyms\/[^/]+\/routes$/.test(url.pathname) &&
                url.searchParams.get('location') === seeded.locationId
            )
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
    testPrefix,
    createUser,
    createRoute,
}) => {
    const climber = await createUser()
    const route = await createRoute({
        name: `${testPrefix}-keepalive-route`,
        ...uiaa('6+'),
        color: '#2196F3',
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
