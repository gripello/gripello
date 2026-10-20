import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { createCompetition } from '../../support/api'

test.use({ viewport: { width: 360, height: 740 } })

test('nested pages get a back arrow in the top bar, tab roots do not', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/account')
    await expect(page.getByTestId('nav-back')).toHaveCount(0)

    await gotoSettled(page, '/account/settings')
    await page.getByTestId('nav-back').click()
    await page.waitForURL(/\/account$/)
    await expect(page.getByTestId('nav-back')).toHaveCount(0)
})

test('top-bar back leaves settings after browsing its sections', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/account')
    await page.getByTestId('me-profile').click()
    await page.waitForURL(/\/account\/settings$/)

    for (const section of ['security', 'privacy']) {
        await page.getByTestId(`profile-drill-${section}`).click()
        await page.waitForURL(new RegExp(`tab=${section}`))
        await page.getByTestId('profile-drill-back').click()
        await page.waitForURL(/\/account\/settings$/)
    }

    await page.getByTestId('profile-drill-security').click()
    await page.getByTestId('nav-back').click()
    await page.waitForURL(/\/account\/settings$/)
    await page.getByTestId('nav-back').click()
    await page.waitForURL(/\/account$/)
})

test('hardware back from a settings section goes to the list, then off the page', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/account')
    await page.getByTestId('me-profile').click()
    await page.waitForURL(/\/account\/settings$/)

    for (const section of ['preferences', 'notifications', 'privacy']) {
        await page.getByTestId(`profile-drill-${section}`).click()
        await page.waitForURL(new RegExp(`tab=${section}`))
        await page.getByTestId('profile-drill-back').click()
        await page.waitForURL(/\/account\/settings$/)
    }

    await page.getByTestId('profile-drill-security').click()
    await page.waitForURL(/tab=security/)
    await page.goBack()
    await expect(page).toHaveURL(/\/account\/settings$/)
    await expect(page.getByTestId('profile-drill-security')).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/account$/)
    await page.goForward()
    await expect(page).toHaveURL(/\/account\/settings$/)
})

test.describe('top-bar back on a cold deep link stays in the app', () => {
    test('competition rules go to the competition', async ({
        page,
        adminApi,
        workerLocation,
        testPrefix,
    }) => {
        const competition = await createCompetition(adminApi, {
            name: `${testPrefix} Rules Cup`,
            location: workerLocation.id,
            status: 'open',
            discipline: 'boulder',
            scoring_format: 'dynamic',
            starts_at: new Date(Date.now() - 3600_000).toISOString(),
            ends_at: new Date(Date.now() + 3600_000).toISOString(),
        })
        await expectBackTo(
            page,
            gymPath(`/competitions/${competition.id}/rules`),
            gymPath(`/competitions/${competition.id}`),
        )
    })

    test('the judge page goes to the managed competition', async ({
        adminPage,
        adminApi,
        workerLocation,
        testPrefix,
    }) => {
        const competition = await createCompetition(adminApi, {
            name: `${testPrefix} Judge Cup`,
            location: workerLocation.id,
            status: 'open',
            discipline: 'boulder',
            scoring_format: 'dynamic',
            starts_at: new Date(Date.now() - 3600_000).toISOString(),
            ends_at: new Date(Date.now() + 3600_000).toISOString(),
        })
        await expectBackTo(
            adminPage,
            gymPath(`/manage/competitions/${competition.id}/judge`),
            gymPath(`/manage/competitions/${competition.id}`),
        )
    })

    test('a climber profile goes to friends', async ({
        userPage,
        createUser,
    }) => {
        const climber = await createUser('user', 'profile')
        await expectBackTo(userPage, `/climber?id=${climber.id}`, '/friends')
    })

    test('a route goes to the gym route list', async ({ page, route }) => {
        await expectBackTo(page, `/route?id=${route.id}`, gymPath('/routes'))
    })

    test('a server log issue goes to More', async ({ platformPage }) => {
        await expectBackTo(
            platformPage,
            '/platform/logs?issue=e2e-missing-issue',
            '/platform/more',
        )
    })
})

async function expectBackTo(page: Page, deepLink: string, parent: string) {
    await gotoSettled(page, deepLink)
    await page.getByTestId('nav-back').click()
    await page.waitForURL((url) => url.pathname === parent)
    await expect(page.getByTestId('page-hydrated')).toBeAttached()
}
