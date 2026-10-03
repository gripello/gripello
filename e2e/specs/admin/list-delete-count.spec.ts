import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createComment } from '../../support/comments'

test('deleting a comment lowers the total by exactly one', async ({
    adminPage: page,
    testPrefix,
    route,
}) => {
    await gotoSettled(page, '/manage/comments')
    await createComment(page, route.id, `${testPrefix}-count-kept`)
    const deletedId = await createComment(
        page,
        route.id,
        `${testPrefix}-count-deleted`,
    )
    await gotoSettled(page, '/manage/comments')

    await page.getByTestId('filter-search').fill(testPrefix)
    const showing = page.getByTestId('comments-showing')
    await expect(showing).toHaveText('Showing 2 of 2 reviews')

    await page
        .getByTestId(`comment-card-${deletedId}`)
        .getByTestId('comment-card-delete')
        .click()
    await page.getByTestId('confirm-dialog-confirm').click()

    await expect(page.getByTestId(`comment-card-${deletedId}`)).toHaveCount(0)
    await expect(showing).toHaveText('Showing 1 of 1 reviews')
})

test('a realtime comment outside the active filter is not inserted', async ({
    adminPage: page,
    testPrefix,
    route,
}) => {
    await gotoSettled(page, '/manage/comments')
    await page.getByTestId('filter-search').fill(testPrefix)
    await page.getByTestId('comments-filter-rating-1').click()

    const hiddenId = await createComment(
        page,
        route.id,
        `${testPrefix}-five-stars`,
        5,
    )
    const visibleId = await createComment(
        page,
        route.id,
        `${testPrefix}-one-star`,
        1,
    )

    await expect(page.getByTestId(`comment-card-${visibleId}`)).toBeVisible()
    await expect(page.getByTestId(`comment-card-${hiddenId}`)).toHaveCount(0)
    await expect(page.getByTestId('comments-showing')).toHaveText(
        'Showing 1 of 1 reviews',
    )
})

test('a realtime comment under a non-date sort refetches instead of inflating the total', async ({
    adminPage: page,
    testPrefix,
    route,
}) => {
    await gotoSettled(page, '/manage/comments')
    await page.getByTestId('filter-search').fill(testPrefix)
    await page.getByTestId('comments-sort').click()
    await page.getByRole('option', { name: 'Most stars' }).click()

    const lowId = await createComment(
        page,
        route.id,
        `${testPrefix}-sort-low`,
        2,
    )
    const highId = await createComment(
        page,
        route.id,
        `${testPrefix}-sort-high`,
        5,
    )

    const cards = page
        .getByTestId(/^comment-card-[a-z0-9]{15}$/)
        .filter({ hasText: testPrefix })
    await expect(page.getByTestId(`comment-card-${highId}`)).toBeVisible()
    await expect(page.getByTestId(`comment-card-${lowId}`)).toBeVisible()
    await expect(page.getByTestId('comments-showing')).toHaveText(
        'Showing 2 of 2 reviews',
    )
    await expect(cards.first()).toContainText(`${testPrefix}-sort-high`)
})
