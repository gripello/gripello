import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createComment } from '../../support/comments'

test('the week filter sends an RFC 3339 cutoff and keeps new comments', async ({
    adminPage: page,
    testPrefix,
    route,
}) => {
    await gotoSettled(page, '/manage/comments')
    const id = await createComment(page, route.id, `${testPrefix}-this-week`)
    await gotoSettled(page, '/manage/comments')
    await page.getByTestId('filter-search').fill(testPrefix)

    const filterRequest = page.waitForRequest((request) => {
        const url = new URL(request.url())
        return (
            /^\/api\/gyms\/[^/]+\/ratings$/.test(url.pathname) &&
            url.searchParams.has('since')
        )
    })
    await page
        .getByTestId('comments-filter-date')
        .getByRole('tab', { name: 'This week' })
        .click()

    const since = new URL((await filterRequest).url()).searchParams.get('since')
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(Number.isNaN(Date.parse(since!))).toBe(false)
    await expect(page.getByTestId(`comment-card-${id}`)).toBeVisible()
})
