import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('an anonymous visitor can submit a review', async ({ page, route }) => {
    await gotoSettled(page, `/route?id=${route.id}`)

    await page.getByTestId('review-open-cta').click()
    await expect(page.getByTestId('review-form-dialog')).toBeVisible()

    await page
        .getByTestId('review-form-rating')
        .getByRole('radio', { name: /5\/5$/ })
        .click()
    await page.getByTestId('review-form-difficulty').click()
    await page.getByRole('option').first().click()
    await expect(page.getByRole('listbox')).toBeHidden()
    await page
        .getByTestId('review-form-comment')
        .first()
        .fill('Great climb, e2e review')
    await page.getByTestId('review-form-submit').click()

    await expect(page.getByTestId('review-form-dialog')).toBeHidden()

    await expect(page.getByTestId('comment-card-report').first()).toBeVisible()
    await expect(page.getByTestId('empty-state')).toBeHidden()
})

test('rolls the review back when the submit fails', async ({ page, route }) => {
    await gotoSettled(page, `/route?id=${route.id}`)

    await page.getByTestId('review-open-cta').click()
    await expect(page.getByTestId('review-form-dialog')).toBeVisible()

    await page.route('**/api/routes/*/ratings', (route) =>
        route.request().method() === 'POST'
            ? route.abort('failed')
            : route.fallback(),
    )

    await page
        .getByTestId('review-form-rating')
        .getByRole('radio', { name: /5\/5$/ })
        .click()
    await page.getByTestId('review-form-difficulty').click()
    await page.getByRole('option').first().click()
    await expect(page.getByRole('listbox')).toBeHidden()
    await page
        .getByTestId('review-form-comment')
        .first()
        .fill('Should not be submitted, network fails')
    await page.getByTestId('review-form-submit').click()

    await expect(page.getByTestId('review-form-dialog')).toBeHidden()
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect(page.getByTestId('comment-card-report')).toHaveCount(0)
    await expect(page.getByTestId('empty-state')).toBeVisible()
})

test('blocks submit when no rating is selected', async ({ page, route }) => {
    await gotoSettled(page, `/route?id=${route.id}`)

    await page.getByTestId('review-open-cta').click()
    await expect(page.getByTestId('review-form-dialog')).toBeVisible()

    await expect(page.getByTestId('review-form-submit')).toBeDisabled()
    await expect(page.getByTestId('review-form-dialog')).toBeVisible()
})
