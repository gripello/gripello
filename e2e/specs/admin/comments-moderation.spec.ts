import { test, expect } from '../../support/fixtures'
import { gotoSettled, authHeader } from '../../support/nav'
import { createComment } from '../../support/comments'

test('shows seeded review stats and sends a comment to moderation', async ({
    adminPage: page,
    testPrefix,
    route,
}) => {
    await gotoSettled(page, '/manage/comments')
    await expect(page.getByTestId('comments-stat-total')).toBeVisible()

    const id = await createComment(page, route.id, `${testPrefix}-moderate-me`)
    await gotoSettled(page, '/manage/comments')

    const card = page.getByTestId(`comment-card-${id}`)
    await expect(card.getByTestId('comment-card-delete')).toHaveCount(0)
    await card.getByTestId('comment-card-moderate').click()
    await page.waitForURL(/\/manage\/moderation\?case=/)
    await expect(
        page.locator('article[data-testid^="moderation-detail-"]:visible'),
    ).toContainText(`${testPrefix}-moderate-me`)
})

test('edits a comment', async ({ adminPage: page, testPrefix, route }) => {
    await gotoSettled(page, '/manage/comments')
    const id = await createComment(page, route.id, `${testPrefix}-before-edit`)
    await gotoSettled(page, '/manage/comments')

    const card = page.getByTestId(`comment-card-${id}`)
    await expect(card).toBeVisible()
    await card.getByTestId('comment-card-edit').click()

    await expect(page.getByTestId('review-form-dialog')).toBeVisible()
    const newComment = `${testPrefix}-edited-comment`
    await page.getByTestId('review-form-comment').fill(newComment)
    await page.getByTestId('review-form-submit').click()

    await expect(page.getByTestId('review-form-dialog')).toBeHidden()
    await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
    await expect(card).toContainText(newComment)
})

test('filters comments by star rating', async ({ adminPage: page }) => {
    await gotoSettled(page, '/manage/comments')
    await page.getByTestId('comments-filter-rating-5').click()
    await expect(page.getByTestId('comments-filter-rating-5')).toHaveAttribute(
        'aria-pressed',
        'true',
    )
})

test('a user without manage_comments is redirected away from /manage/comments', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/manage/comments')
    await page.waitForURL((url) => !url.pathname.endsWith('/manage/comments'))

    const headers = await authHeader(page)
    const res = await page.request.delete(
        '/api/collections/ratings/records/nonexistent',
        { headers },
    )
    expect(res.status()).toBeGreaterThanOrEqual(400)
})
