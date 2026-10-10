import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import { listOwnTicks } from '../../support/api'
import { E2E_GYM_SLUG, uiaa } from '../../support/seed'

test.use({
    launchOptions: { args: ['--ignore-certificate-errors'] },
    serviceWorkers: 'allow',
})

test('an ascent logged offline syncs when the connection returns', async ({
    page,
    apiAs,
    testPrefix,
    createUser,
    createRoute,
}) => {
    const climber = await createUser()
    const route = await createRoute({
        name: `${testPrefix}-offline-route`,
        ...uiaa('6'),
        color: '#2196F3',
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
    const climberApi = await apiAs(climber)
    await expect
        .poll(
            async () =>
                (await listOwnTicks(climberApi)).filter(
                    (tick) => tick.route === route.id,
                ).length,
        )
        .toBe(1)
    await expect(pending).toHaveCount(0)
    await expect(
        page.getByTestId('logbook-tick').filter({ hasText: route.name }),
    ).toBeVisible()
})
