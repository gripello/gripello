import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createRating } from '../../support/api'

test.beforeEach(async ({ adminApi, route, testPrefix }) => {
    await createRating(adminApi, route.id, {
        rating: 2,
        comment: `${testPrefix}-reportable`,
    })
})

async function openReportDialog(page: Page, routeId: string) {
    await gotoSettled(page, `/route?id=${routeId}`)

    const reportButton = page.getByTestId('comment-card-report').first()
    await reportButton.waitFor()
    await reportButton.click()
    await expect(page.getByTestId('report-form-dialog')).toBeVisible()
}

async function fillValidReport(page: Page, testPrefix: string) {
    await page.getByTestId('report-form-reason').click()
    await page.getByRole('option').first().click()
    await expect(page.getByRole('listbox')).toBeHidden()
    await page
        .getByTestId('report-form-explanation')
        .first()
        .fill(`${testPrefix} this comment is abusive`)
    await page.getByTestId('report-form-name').first().fill('E2E Reporter')
    await page
        .getByTestId('report-form-email')
        .first()
        .fill('e2e-reporter@example.com')
}

test('an anonymous visitor can report a comment', async ({
    page,
    route,
    testPrefix,
}) => {
    await openReportDialog(page, route.id)
    await fillValidReport(page, testPrefix)
    await page.getByTestId('report-form-goodfaith').check()

    await page.getByTestId('report-form-submit').click()

    await expect(page.getByTestId('report-form-dialog')).toBeHidden()
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
})

test('submit stays disabled until the good-faith declaration is accepted', async ({
    page,
    route,
    testPrefix,
}) => {
    await openReportDialog(page, route.id)
    await fillValidReport(page, testPrefix)

    await expect(page.getByTestId('report-form-submit')).toBeDisabled()

    await page.getByTestId('report-form-goodfaith').check()
    await expect(page.getByTestId('report-form-submit')).toBeEnabled()
})

test('submit stays disabled for a malformed notifier email', async ({
    page,
    route,
    testPrefix,
}) => {
    await openReportDialog(page, route.id)
    await fillValidReport(page, testPrefix)
    await page.getByTestId('report-form-goodfaith').check()
    await expect(page.getByTestId('report-form-submit')).toBeEnabled()

    await page.getByTestId('report-form-email').first().fill('not-an-email')

    await expect(page.getByTestId('report-form-submit')).toBeDisabled()
})

test('a failed submit surfaces an error and keeps the dialog open', async ({
    page,
    route,
    testPrefix,
}) => {
    await openReportDialog(page, route.id)
    await fillValidReport(page, testPrefix)
    await page.getByTestId('report-form-goodfaith').check()

    const endpoint = '**/api/reports'
    await page.route(endpoint, (route) => route.abort('failed'))

    await page.getByTestId('report-form-submit').click()

    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect(page.getByTestId('report-form-dialog')).toBeVisible()

    await page.unroute(endpoint)
})
