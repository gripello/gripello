import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { BOULDER, openBoulderCompetition } from '../../support/competitions'

type UrlMatch = (url: URL) => boolean

async function navigateInApp(page: Page, path: string) {
    await page.evaluate(async (target) => {
        const root = document.querySelector('#__nuxt') as unknown as {
            __vue_app__: {
                config: {
                    globalProperties: {
                        $router: { push: (to: string) => Promise<unknown> }
                    }
                }
            }
        }
        await root.__vue_app__.config.globalProperties.$router.push(target)
    }, path)
}

async function expectRetryRecovers(
    page: Page,
    path: string,
    failing: UrlMatch,
    loaded: () => Promise<void>,
) {
    await page.route(failing, (route) =>
        route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ status: 500, message: 'boom', data: {} }),
        }),
    )
    await navigateInApp(page, path)

    const loadError = page.getByTestId('load-error')
    await expect(loadError).toBeVisible()
    await expect(loadError).toHaveAttribute('role', 'alert')
    await expect(page.getByTestId('index-empty-wish')).toHaveCount(0)
    await expect(page.getByText('No data', { exact: true })).toHaveCount(0)

    await page.unroute(failing)
    const retry = page.getByTestId('load-error-retry')
    await expect(async () => {
        if (await retry.isVisible()) await retry.click({ timeout: 2_000 })
        await expect(loadError).toBeHidden({ timeout: 2_000 })
    }).toPass()
    await loaded()
}

const gymApi =
    (resource: string): UrlMatch =>
    (url) =>
        new RegExp(`^/api/gyms/[^/]+/${resource}$`).test(url.pathname)

test.describe('pages offer a retry when their data fails to load', () => {
    test('route list', async ({ page, route }) => {
        await gotoSettled(page, gymPath('/'))
        await expectRetryRecovers(
            page,
            gymPath('/routes'),
            gymApi('routes'),
            async () => {
                await page.getByTestId('filter-search').fill(route.name)
                await expect(
                    page.getByText(route.name, { exact: true }).first(),
                ).toBeVisible()
            },
        )
    })

    test('route management', async ({ adminPage, route }) => {
        await gotoSettled(adminPage, gymPath('/manage'))
        await expectRetryRecovers(
            adminPage,
            gymPath('/manage/routes'),
            gymApi('routes'),
            async () => {
                await adminPage.getByTestId('filter-search').fill(route.name)
                await expect(
                    adminPage.getByTestId(`routes-row-${route.id}`),
                ).toBeVisible()
            },
        )
    })

    test('task board', async ({ adminPage }) => {
        await gotoSettled(adminPage, gymPath('/manage'))
        await expectRetryRecovers(
            adminPage,
            gymPath('/manage/tasks'),
            gymApi('tasks'),
            async () => {
                await expect(adminPage.getByTestId('task-board')).toBeVisible()
            },
        )
    })

    test('activity log', async ({ adminPage }) => {
        await gotoSettled(adminPage, gymPath('/manage'))
        await expectRetryRecovers(
            adminPage,
            '/account/activity',
            (url) => /\/audit$/.test(url.pathname),
            async () => {
                await expect(adminPage.getByTestId('load-error')).toHaveCount(0)
            },
        )
    })

    test('review moderation', async ({ adminPage }) => {
        await gotoSettled(adminPage, gymPath('/manage'))
        await expectRetryRecovers(
            adminPage,
            gymPath('/manage/comments'),
            gymApi('ratings'),
            async () => {
                await expect(adminPage.getByTestId('load-error')).toHaveCount(0)
            },
        )
    })

    test('route placement map', async ({ adminPage, workerLocation }) => {
        await gotoSettled(adminPage, gymPath('/manage'))
        await expectRetryRecovers(
            adminPage,
            gymPath(`/manage/map?location=${workerLocation.id}`),
            (url) =>
                gymApi('routes')(url) &&
                url.searchParams.get('location') === workerLocation.id,
            async () => {
                await expect(
                    adminPage.getByTestId('placement-empty'),
                ).toBeVisible()
            },
        )
    })

    test('judging', async ({
        adminPage,
        adminApi,
        workerLocation,
        createRoute,
        createUser,
        testPrefix,
    }) => {
        const climber = await createUser('user', 'loadjudge')
        const {
            competition,
            entries: [entry],
        } = await openBoulderCompetition(adminApi, {
            name: `${testPrefix} Load Cup`,
            location: workerLocation.id,
            routes: [
                await createRoute({ name: `${testPrefix} B1`, ...BOULDER }),
            ],
            climbers: [{ user: climber, name: `${testPrefix} Climber` }],
        })

        await gotoSettled(adminPage, gymPath('/manage'))
        await expectRetryRecovers(
            adminPage,
            gymPath(`/manage/competitions/${competition.id}/judge`),
            (url) =>
                url.pathname === `/api/competitions/${competition.id}/entries`,
            async () => {
                await expect(
                    adminPage.getByTestId(`judge-entry-${entry!.bib}`),
                ).toBeVisible()
            },
        )
    })
})
