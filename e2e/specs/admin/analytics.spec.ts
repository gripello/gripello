import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import {
    authHeader,
    gotoSettled,
    gotoSubscribed,
    gymPath,
} from '../../support/nav'
import { gradeOf, uiaa } from '../../support/seed'
import {
    archiveRoute,
    createRating,
    createRoute,
    e2eGymId,
    routeInput,
    updateRoute,
    type Api,
} from '../../support/api'

const newRoute = (
    api: Api,
    name: string,
    location: string,
    data: Record<string, unknown>,
) => createRoute(api, routeInput(name, location, data))

function stat(page: Page, key: string) {
    return page
        .getByTestId(`analytics-stat-${key}`)
        .getByTestId('stats-card-value')
}

async function statValue(page: Page, key: string) {
    await expect(stat(page, key)).not.toBeEmpty()
    return Number((await stat(page, key).textContent())?.trim())
}

function trend(page: Page, key: string) {
    return page
        .getByTestId(`analytics-stat-${key}`)
        .getByTestId('stats-card-trend')
}

async function analyticsListsSetter(
    response: { url(): string; json(): Promise<unknown> },
    setter: string,
) {
    if (!response.url().includes('/api/manage/analytics')) return false
    const body = (await response.json().catch(() => null)) as {
        setters?: { setter: string }[]
    } | null
    return !!body?.setters?.some((entry) => entry.setter === setter)
}

test('renders kpis with trends, sparklines, meters and charts', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/analytics')

    for (const key of [
        'activeRoutes',
        'routesSet',
        'ratings',
        'averageRating',
        'comments',
        'averageLifespan',
    ]) {
        await expect(stat(page, key)).not.toBeEmpty()
    }
    await expect(trend(page, 'routesSet')).toBeVisible()
    await expect(
        page
            .getByTestId('analytics-stat-routesSet')
            .getByTestId('stats-card-spark'),
    ).toBeVisible()
    await expect(
        page
            .getByTestId('analytics-stat-activeRoutes')
            .getByTestId('stats-card-meter'),
    ).toBeVisible()

    for (const chart of [
        'analytics-chart-grades',
        'analytics-chart-activity',
        'analytics-chart-location-grades',
        'analytics-chart-age',
    ]) {
        await expect(page.getByTestId(chart)).toBeVisible()
    }
})

test('analytics api rejects users without the view_analytics permission', async ({
    userPage: page,
    request,
}) => {
    await gotoSettled(page, gymPath('/'))
    const forbidden = await page.request.get('/api/manage/analytics', {
        headers: await authHeader(page),
    })
    expect(forbidden.status()).toBe(403)

    const anonymous = await request.get('/api/manage/analytics')
    expect(anonymous.status()).toBe(401)
})

test('filters live in the url and survive a reload', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/analytics?range=all')
    const allRoutes = await statValue(page, 'activeRoutes')
    await expect(trend(page, 'routesSet')).toHaveCount(0)

    await page.getByTestId('analytics-range-30d').click()
    await expect(page).toHaveURL(/range=30d/)
    await expect(trend(page, 'routesSet')).toBeVisible()

    await gotoSettled(page, page.url())
    await expect(
        page
            .getByRole('tab')
            .filter({ has: page.getByTestId('analytics-range-30d') }),
    ).toHaveAttribute('aria-selected', 'true')

    await gotoSettled(page, '/manage/analytics?range=all&type=Boulder')
    await expect(page.getByTestId('analytics-filter-type')).toContainText(
        'Boulder',
    )
    await expect
        .poll(() => statValue(page, 'activeRoutes'))
        .toBeLessThan(allRoutes)
})

test('grade charts switch discipline in place and follow the type filter', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    workerLocation,
}) => {
    for (const type of ['Route', 'Boulder']) {
        await newRoute(adminApi, `${testPrefix}-${type}`, workerLocation.id, {
            ...(type === 'Boulder' ? gradeOf('font', '6A') : uiaa('6')),
            type,
            creator: [`${testPrefix}-setter`],
            screw_date: new Date().toISOString(),
        })
    }
    await gotoSettled(page, '/manage/analytics?range=all')
    await page.getByTestId('analytics-discipline-grades-Boulder').click()
    await expect(
        page
            .getByTestId('analytics-discipline-locationGrades-Boulder')
            .locator('xpath=ancestor::*[@role="tab"]'),
    ).toHaveAttribute('aria-selected', 'true')

    await gotoSettled(page, '/manage/analytics?range=all&type=Route')
    await expect(page.getByTestId('analytics-chart-grades')).toBeVisible()
    await expect(page.getByTestId('analytics-discipline-grades')).toHaveCount(0)
})

test('archived chip matches the routes page and toggles the url', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/analytics?range=all')
    const chip = page.getByTestId('analytics-filter-archived')
    await expect(chip).toHaveAttribute('aria-pressed', 'false')

    await chip.click()
    await expect(page).toHaveURL(/archived=true/)
    await expect(chip).toHaveAttribute('aria-pressed', 'true')

    await chip.click()
    await expect(page).not.toHaveURL(/archived=true/)
    await expect(chip).toHaveAttribute('aria-pressed', 'false')
})

test('filters share one row with the ranges on wide screens', async ({
    adminPage: page,
}) => {
    const rowOf = async (testId: string) => {
        const box = await page.getByTestId(testId).boundingBox()
        return Math.round(box!.y + box!.height / 2)
    }

    await page.setViewportSize({ width: 1920, height: 900 })
    await gotoSettled(page, '/manage/analytics?range=all')
    await expect
        .poll(
            async () =>
                (await rowOf('analytics-filter-location')) -
                (await rowOf('analytics-range-all')),
        )
        .toBe(0)

    await page.setViewportSize({ width: 1024, height: 900 })
    await expect
        .poll(
            async () =>
                (await rowOf('analytics-filter-location')) -
                (await rowOf('analytics-range-all')),
        )
        .toBeGreaterThan(0)
})

test('custom range writes the dates into the url', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/analytics')
    await page.getByTestId('analytics-range-custom').click()
    await page.getByTestId('analytics-filter-from').fill('2020-01-01')
    await expect(page).toHaveURL(/range=custom/)
    await expect(page).toHaveURL(/from=2020-01-01/)
})

test('updates live when a route is created elsewhere', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    workerLocation,
}) => {
    await gotoSubscribed(
        page,
        '/manage/analytics?range=30d',
        `gym_changes:${await e2eGymId()}`,
    )

    const setter = `${testPrefix}-live-setter`
    const liveRefresh = page.waitForResponse((response) =>
        analyticsListsSetter(response, setter),
    )
    await newRoute(adminApi, `${testPrefix}-live-route`, workerLocation.id, {
        ...uiaa('5'),
        type: 'Route',
        creator: [setter],
        screw_date: new Date().toISOString(),
    })
    await liveRefresh
})

test('refreshes during a steady stream of route changes', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    workerLocation,
}) => {
    await gotoSubscribed(
        page,
        '/manage/analytics?range=30d',
        `gym_changes:${await e2eGymId()}`,
    )

    const setter = `${testPrefix}-stream-setter`
    let refreshed = false
    page.on('response', async (response) => {
        if (await analyticsListsSetter(response, setter)) refreshed = true
    })
    let index = 0
    await expect
        .poll(
            async () => {
                if (!refreshed) {
                    await newRoute(
                        adminApi,
                        `${testPrefix}-stream-route-${index++}`,
                        workerLocation.id,
                        {
                            ...uiaa('5'),
                            type: 'Route',
                            creator: [setter],
                            screw_date: new Date().toISOString(),
                        },
                    )
                }
                return refreshed
            },
            { intervals: [500], timeout: 8_000 },
        )
        .toBe(true)
})

test('heatmap tooltip hides when the page scrolls', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 390, height: 600 })
    await gotoSettled(page, '/manage/analytics?range=all')
    const heatmap = page.getByTestId('analytics-heatmap')
    await heatmap.scrollIntoViewIfNeeded()
    await heatmap.locator('[data-date]').last().click()
    const tooltip = page.getByTestId('analytics-heatmap-tooltip')
    await expect(tooltip).toBeVisible()
    await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(0)
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(tooltip).toBeHidden()
})

test('heatmap switches years and shows day counts', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    workerLocation,
}) => {
    await newRoute(adminApi, `${testPrefix}-heatmap-route`, workerLocation.id, {
        ...uiaa('5'),
        type: 'Route',
        creator: [`${testPrefix}-heatmap-setter`],
        screw_date: '2011-06-15',
    })
    await gotoSettled(page, '/manage/analytics?range=all')
    const heatmap = page.getByTestId('analytics-heatmap')
    const days = heatmap.locator('[data-date]')
    await expect.poll(() => days.count()).toBeGreaterThanOrEqual(365)
    expect(await days.count()).toBeLessThanOrEqual(366)

    await heatmap.getByTestId('analytics-heatmap-year-2011').click()
    await expect(heatmap.getByTestId('analytics-heatmap-total')).toContainText(
        '2011',
    )

    const cell = heatmap.locator('[data-date="2011-06-15"]')
    await expect(cell).toHaveAttribute('data-count', /[1-9]/)
    await expect(cell).not.toHaveClass(/heatmap-level-0/)
    await expect(days).toHaveCount(365)

    await cell.hover()
    await expect(page.getByTestId('analytics-heatmap-tooltip')).toBeVisible()
})

test('reports routes whose grade votes are harder than the set grade', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    workerLocation,
}) => {
    const route = await newRoute(
        adminApi,
        `${testPrefix}-sandbag`,
        workerLocation.id,
        {
            ...uiaa('1'),
            type: 'Route',
            creator: ['Sandbagger'],
            screw_date: new Date().toISOString(),
        },
    )
    for (let vote = 0; vote < 3; vote++) {
        await createRating(adminApi, route.id, { rating: 4, ...uiaa('10') })
    }
    await gotoSettled(page, '/manage/analytics?range=all&type=Route')
    await expect(
        page.getByTestId('analytics-chart-grade-feedback'),
    ).toBeVisible()

    const response = await page.request.get(
        `/api/manage/analytics?range=all&gym=${await e2eGymId()}`,
        {
            headers: await authHeader(page),
        },
    )
    const { grades } = await response.json()
    const gradeFeedback = grades.Route.gradeFeedback
    const sandbag = gradeFeedback.find(
        (entry: { id: string }) => entry.id === route.id,
    )
    expect(sandbag).toMatchObject({ setGrade: 1 })
    expect(sandbag.grade).toMatch(/^1( · UIAA)?$/)
    expect(sandbag.deviation).toBeGreaterThan(8)
})

test('archiving a route stamps archived_at and restoring clears it', async ({
    adminApi,
    testPrefix,
    workerLocation,
}) => {
    const route = await newRoute(
        adminApi,
        `${testPrefix}-archive`,
        workerLocation.id,
        {
            ...uiaa('4'),
            type: 'Boulder',
            creator: [`${testPrefix}-archive-setter`],
        },
    )
    expect(route.archived_at).toBeFalsy()

    const archived = await archiveRoute(adminApi, route.id)
    expect(archived.archived_at).toBeTruthy()

    const edited = await updateRoute(adminApi, route.id, {
        name: `${testPrefix}-archive-renamed`,
    })
    expect(edited.archived_at).toBe(archived.archived_at)

    const restored = await archiveRoute(adminApi, route.id, false)
    expect(restored.archived_at).toBeFalsy()
})

test('archived routes are left out like on the routes page unless included', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    workerLocation,
}) => {
    const setter = `${testPrefix}-archived-setter`
    await newRoute(
        adminApi,
        `${testPrefix}-archived-analytics`,
        workerLocation.id,
        {
            ...uiaa('5'),
            type: 'Boulder',
            creator: [setter],
            archived: true,
        },
    )
    await gotoSettled(page, '/manage/analytics')
    const settersFor = async (query: string) => {
        const response = await page.request.get(
            `/api/manage/analytics?range=all&gym=${await e2eGymId()}${query}`,
            { headers: await authHeader(page) },
        )
        const body = (await response.json()) as {
            setters: { setter: string }[]
        }
        return body.setters.map((entry) => entry.setter)
    }

    expect(await settersFor('')).not.toContain(setter)
    expect(await settersFor('&archived=true')).toContain(setter)
})

test('has no horizontal scroll on phones', async ({ adminPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoSettled(page, '/manage/analytics')
    await expect(page.getByTestId('analytics-filters')).toBeVisible()
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    document.documentElement.scrollWidth -
                    document.documentElement.clientWidth,
            ),
        )
        .toBeLessThanOrEqual(0)
})

test('shows an error notification when the analytics fetch fails', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/analytics')
    await page.route('**/api/manage/analytics*', (route) =>
        route.fulfill({ status: 500, body: 'boom' }),
    )
    await page.getByTestId('analytics-range-30d').click()
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
})
