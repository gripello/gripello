import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { uiaa } from '../../support/seed'
import { createRating, deleteRating } from '../../support/api'

const REVIEW_COUNT = 60

test('loading more after deletes still reaches every review', async ({
    adminPage: page,
    adminApi,
    testPrefix,
    createRoute,
}) => {
    const route = await createRoute({ name: `${testPrefix}-paging` })
    const ratingIds: string[] = []
    for (let index = 0; index < REVIEW_COUNT; index++) {
        const rating = await createRating(adminApi, route.id, {
            rating: 3,
            ...uiaa('5'),
            comment: `${testPrefix} paging ${index}`,
        })
        ratingIds.push(rating.id)
    }

    await gotoSettled(page, '/manage/comments')
    await page.getByTestId('filter-search').fill(testPrefix)
    const showing = page.getByTestId('comments-showing')
    await expect(showing).toHaveText('Showing 48 of 60 reviews')

    for (const id of ratingIds.slice(-3)) await deleteRating(adminApi, id)
    await expect(showing).toHaveText('Showing 45 of 57 reviews')

    await showing.scrollIntoViewIfNeeded()
    await expect(showing).toHaveText('Showing 57 of 57 reviews')
})
