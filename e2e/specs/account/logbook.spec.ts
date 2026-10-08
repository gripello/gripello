import { test, expect } from '../../support/fixtures'
import { gotoSettled, gotoSubscribed } from '../../support/nav'
import { signInAs } from '../../support/auth'
import { ensureUser, getRoleIds, uiaa } from '../../support/seed'

test('the logbook sends guests to sign in and back', async ({ page }) => {
    await page.goto('/logbook')
    await page.waitForURL(
        (url) =>
            url.pathname === '/auth/login' &&
            url.searchParams.get('redirect') === '/logbook',
    )
})

test('a climber logs, edits and deletes an ascent', async ({
    page,
    root,
    testPrefix,
    workerLocation,
}) => {
    const roleIds = await getRoleIds(root)
    const climber = await ensureUser(root, roleIds.user, 'user', testPrefix)
    const route = await root.collection('routes').create({
        name: `${testPrefix}-tick-route`,
        ...uiaa('6+'),
        location: workerLocation.id,
        type: 'Route',
        color: '#2196F3',
        creator: ['E2E'],
        screw_date: '2026-09-01',
    })

    await signInAs(page, climber.email, climber.password)

    await gotoSettled(page, '/logbook')
    await expect(page.getByTestId('logbook-empty')).toBeVisible()
    await expect(page.getByTestId('logbook-suggestions')).toBeVisible()

    await gotoSettled(page, `/route?id=${route.id}`)
    await expect(page.getByTestId('route-ticked')).toHaveCount(0)
    await page.getByTestId('tick-open').click()
    await page.getByTestId('tick-type-top').click()
    await page.getByTestId('tick-attempts').fill('3')
    await page.getByTestId('tick-note').first().fill('Crux at the roof')
    await page.getByTestId('tick-submit').click()
    await expect(page.getByTestId('route-ticked')).toBeVisible()

    await gotoSettled(page, '/logbook')
    const tick = page.getByTestId('logbook-tick').filter({
        hasText: route.name,
    })
    await expect(tick.getByTestId('logbook-tick-route')).toContainText(
        route.name,
    )
    await expect(tick.getByTestId('logbook-tick-type')).toHaveText('Top')
    await expect(tick.getByTestId('logbook-tick-attempts')).toContainText('3')
    await expect(tick.getByTestId('logbook-tick-note')).toHaveText(
        'Crux at the roof',
    )

    await tick.getByTestId('logbook-tick-menu').click()
    await page.getByTestId('logbook-tick-edit').click()
    await page.getByTestId('tick-type-flash').click()
    await expect(page.getByTestId('tick-attempts')).toBeDisabled()
    await page.getByTestId('tick-submit').click()
    await expect(tick.getByTestId('logbook-tick-type')).toHaveText('Flash')
    await expect(tick.getByTestId('logbook-tick-attempts')).toHaveCount(0)

    await root.collection('routes').update(route.id, { archived: true })
    await gotoSettled(page, '/logbook')
    await expect(tick.getByTestId('logbook-tick-route')).toContainText(
        route.name,
    )

    await tick.getByTestId('logbook-tick-menu').click()
    await page.getByTestId('logbook-tick-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('logbook-empty')).toBeVisible()
})

test('the dashboard sums up sends and turns a project into a send', async ({
    page,
    root,
    testPrefix,
    workerLocation,
}) => {
    const roleIds = await getRoleIds(root)
    const climber = await ensureUser(
        root,
        roleIds.user,
        'user',
        `${testPrefix}-dash`,
    )
    const createRoute = (name: string, grade: string) =>
        root.collection('routes').create({
            name: `${testPrefix}-${name}`,
            ...uiaa(grade),
            location: workerLocation.id,
            type: 'Route',
            creator: ['E2E'],
            screw_date: '2026-09-01',
        })
    const easy = await createRoute('easy', '6+')
    const hard = await createRoute('hard', '7-')
    const project = await createRoute('project', '8')
    const today = `${new Date().toISOString().slice(0, 10)} 12:00:00.000Z`
    for (const [route, type] of [
        [easy, 'flash'],
        [hard, 'top'],
        [project, 'attempt'],
    ] as const) {
        await root.collection('ticks').create({
            user: climber.id,
            route: route.id,
            type,
            attempts: type === 'flash' ? 1 : 3,
            date: today,
        })
    }

    await signInAs(page, climber.email, climber.password)

    await gotoSettled(page, '/logbook')
    await page.getByTestId('logbook-kind-route').click()
    const value = (key: string) =>
        page.getByTestId(`logbook-stat-${key}`).getByTestId('stats-card-value')
    await expect(value('sends')).toHaveText('2')
    await expect(value('hardest')).toHaveText('7-')
    await expect(value('flashRate')).toHaveText('50%')
    await expect(value('sessions')).toHaveText('1')

    await page.getByTestId('logbook-tab-stats').click()
    await expect(page.getByTestId('logbook-pyramid')).toBeVisible()
    await expect
        .poll(() =>
            page.getByTestId('logbook-pyramid').evaluate((chart) => {
                const svg = chart.querySelector('svg')
                return (
                    (svg?.getBoundingClientRect().width ?? 0) >=
                    chart.getBoundingClientRect().width - 1
                )
            }),
        )
        .toBe(true)
    await expect(page.getByTestId('logbook-progression')).toBeVisible()

    await page.getByTestId('logbook-tab-projects').click()
    await expect(page.getByTestId('logbook-projects-count')).toHaveText('1')
    const card = page.getByTestId('logbook-project')
    await expect(card).toHaveAttribute('data-route-id', project.id)
    await card.getByTestId('logbook-project-log').click()
    await page.getByTestId('tick-submit').click()
    await expect(page.getByTestId('logbook-projects-empty')).toBeVisible()
    await expect(value('sends')).toHaveText('3')
})

test('an ascent logged on another device appears in the open logbook', async ({
    page,
    root,
    testPrefix,
    workerLocation,
}) => {
    const roleIds = await getRoleIds(root)
    const climber = await ensureUser(root, roleIds.user, 'user', testPrefix)
    const route = await root.collection('routes').create({
        name: `${testPrefix}-live-tick-route`,
        ...uiaa('6+'),
        location: workerLocation.id,
        type: 'Route',
        color: '#2196F3',
        creator: ['E2E'],
        screw_date: '2026-09-01',
    })

    await signInAs(page, climber.email, climber.password)
    await gotoSubscribed(page, '/logbook', 'own_ticks')
    await expect(page.getByTestId('logbook-empty')).toBeVisible()

    await root.collection('ticks').create({
        user: climber.id,
        route: route.id,
        type: 'flash',
        attempts: 1,
        date: `${new Date().toISOString().slice(0, 10)} 12:00:00.000Z`,
    })

    await expect(
        page.getByTestId('logbook-tick').filter({ hasText: route.name }),
    ).toBeVisible()
})
