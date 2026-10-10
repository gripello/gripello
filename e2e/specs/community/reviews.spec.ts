import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
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
