import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSubscribed, gymPath } from '../../support/nav'
import { createTick, updateRoute } from '../../support/api'

const realtime = (url: URL) => url.pathname.startsWith('/api/realtime')

async function trackRealtimeStreams(page: Page) {
    await page.addInitScript(() => {
        const Native = window.EventSource
        const streams: EventSource[] = []
        Object.assign(window, { __realtimeStreams: streams })
        window.EventSource = class extends Native {
            constructor(url: string | URL, init?: EventSourceInit) {
                super(url, init)
                streams.push(this)
            }
        }
    })
}

async function whileRealtimeIsDown(page: Page, change: () => Promise<void>) {
    await page.route(realtime, (route) => route.abort('failed'))
    await page.evaluate(() => {
        const streams = (
            window as unknown as { __realtimeStreams: EventSource[] }
        ).__realtimeStreams
        for (const stream of streams.splice(0)) {
            stream.close()
            stream.dispatchEvent(new Event('error'))
        }
    })
    await change()
    const reconnected = page.waitForResponse(
        (response) =>
            /\/api\/realtime\/[^/]+\/subscriptions/.test(response.url()) &&
            response.ok(),
    )
    await page.unroute(realtime)
    await reconnected
}

test('changes made while the realtime stream was down show up once it is back', async ({
    adminPage,
    pageAs,
    createUser,
    adminApi,
    route,
    testPrefix,
}) => {
    const climber = await createUser('user', 'resync')
    const climberPage = await pageAs(climber)
    const climberApi = await apiOf(climberPage)
    await trackRealtimeStreams(adminPage)
    await trackRealtimeStreams(climberPage)

    await gotoSubscribed(adminPage, gymPath('/manage/routes'), 'gym_changes')
    await adminPage.getByTestId('filter-search').fill(testPrefix)
    await expect(adminPage.getByTestId('routes-row-name')).toHaveText([
        route.name,
    ])
    await gotoSubscribed(climberPage, '/logbook', 'own_ticks')

    const renamed = `${testPrefix} renamed offline`
    await whileRealtimeIsDown(adminPage, () =>
        updateRoute(adminApi, route.id, { name: renamed }).then(() => {}),
    )
    await whileRealtimeIsDown(climberPage, () =>
        createTick(climberApi, {
            route: route.id,
            type: 'flash',
            note: `${testPrefix} offline send`,
        }).then(() => {}),
    )

    await expect(adminPage.getByTestId('routes-row-name')).toHaveText([renamed])
    await expect(
        climberPage
            .getByTestId('logbook-tick')
            .filter({ hasText: `${testPrefix} offline send` }),
    ).toHaveCount(1)
    await expect(climberPage.getByTestId('logbook-tick')).toHaveCount(1)
})
