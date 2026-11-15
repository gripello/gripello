import { test, expect } from '../../support/fixtures'
import { gotoSettled, gotoSubscribed, reloadSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import {
    apiAs,
    createRating,
    listRouteRatings,
    updateMe,
} from '../../support/api'

test('signed-in climbers see review authors, who can delete their own', async ({
    page,
    pageAs,
    adminApi,
    createUser,
    route,
    testPrefix,
}) => {
    const author = await createUser('user', 'author')
    const reader = await createUser('user', 'reader')
    const authorName = `Rae${testPrefix.replace(/\D/g, '')}`
    const authorApi = await apiAs(author)
    await updateMe(authorApi, { firstname: authorName, name: 'Review' })
    const review = await createRating(authorApi, route.id, {
        rating: 4,
        comment: `${testPrefix} nice moves`,
    })
    const card = (target: typeof page) =>
        target.getByTestId(`comment-card-${review.id}`)

    await gotoSettled(page, `/route?id=${route.id}`)
    await expect(card(page)).toContainText('Anonymous')

    const readerPage = await pageAs(reader)
    await gotoSettled(readerPage, `/route?id=${route.id}`)
    await expect(card(readerPage)).toContainText(`${authorName} Review`)
    await expect(
        card(readerPage).getByTestId('comment-card-delete'),
    ).toHaveCount(0)

    await updateMe(authorApi, { reviews_anonymous: true })
    await gotoSettled(readerPage, `/route?id=${route.id}`)
    await expect(card(readerPage)).toContainText('Anonymous')

    await signInAs(page, author.email, author.password)
    await gotoSettled(page, `/route?id=${route.id}`)
    await card(page).getByTestId('comment-card-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(card(page)).toHaveCount(0)
    expect(
        (await listRouteRatings(adminApi, route.id)).map((rating) => rating.id),
    ).not.toContain(review.id)
})

// Catches: editing your review posting a second one, or the edit never reaching the database.
test('a climber edits their own review in place', async ({
    pageAs,
    adminApi,
    createUser,
    route,
    testPrefix,
}) => {
    const climber = await createUser('user', 'editor')
    const review = await createRating(await apiAs(climber), route.id, {
        rating: 4,
        comment: `${testPrefix} first take`,
    })
    const page = await pageAs(climber)
    await gotoSettled(page, `/route?id=${route.id}`)

    const cta = page.getByTestId('review-open-cta')
    await expect(cta).toHaveText('Edit my review')
    await cta.click()
    const dialog = page.getByTestId('review-form-dialog')
    const comment = page.getByTestId('review-form-comment')
    await expect(comment).toHaveValue(`${testPrefix} first take`)

    await page
        .getByTestId('review-form-rating')
        .getByRole('radio', { name: /2 out of 5$/ })
        .click()
    await comment.fill(`${testPrefix} second take`)
    await page.getByTestId('review-form-submit').click()
    await expect(dialog).toBeHidden()

    await expect
        .poll(async () =>
            (await listRouteRatings(adminApi, route.id)).map((rating) => [
                rating.id,
                rating.rating,
                rating.comment,
            ]),
        )
        .toEqual([[review.id, 2, `${testPrefix} second take`]])
    await reloadSettled(page)
    await expect(page.getByTestId(`comment-card-${review.id}`)).toContainText(
        `${testPrefix} second take`,
    )
    await expect(cta).toHaveText('Edit my review')
})

// Catches: a review written on another device leaving the CTA on "Write a review" until reload.
test('a review from another device turns the CTA into edit live', async ({
    pageAs,
    createUser,
    route,
    testPrefix,
}) => {
    const climber = await createUser('user', 'twodevices')
    const page = await pageAs(climber)
    await gotoSubscribed(page, `/route?id=${route.id}`, 'gym_changes')
    const cta = page.getByTestId('review-open-cta')
    await expect(cta).toHaveText('Write a review')

    const review = await createRating(await apiAs(climber), route.id, {
        rating: 3,
        comment: `${testPrefix} from my phone`,
    })

    await expect(cta).toHaveText('Edit my review')
    await expect(page.getByTestId(`comment-card-${review.id}`)).toBeVisible()
    await cta.click()
    await expect(page.getByTestId('review-form-comment')).toHaveValue(
        `${testPrefix} from my phone`,
    )
})
