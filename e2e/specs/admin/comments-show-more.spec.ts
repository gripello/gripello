import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createComment } from '../../support/comments'

const LONG_COMMENT = 'Sehr schoene Route, wirklich lang. '.repeat(20)

test('show more expands a clipped comment', async ({
    adminPage: page,
    testPrefix,
    route,
}) => {
    await gotoSettled(page, '/manage/comments')
    const id = await createComment(
        page,
        route.id,
        `${testPrefix} ${LONG_COMMENT}`,
    )
    await gotoSettled(page, '/manage/comments')

    const card = page.getByTestId(`comment-card-${id}`)
    await expect(card).toBeVisible()
    const text = card.getByTestId('comment-card-comment')
    const toggle = card.getByTestId('comment-card-toggle')

    await expect(toggle).toBeVisible()
    await expect
        .poll(() => text.evaluate((el) => el.scrollHeight - el.clientHeight))
        .toBeGreaterThan(0)

    await toggle.click()
    await expect
        .poll(async () =>
            text.evaluate((el) => el.scrollHeight - el.clientHeight),
        )
        .toBeLessThanOrEqual(1)
})

test('short comments have no show more button', async ({
    adminPage: page,
    testPrefix,
    route,
}) => {
    await gotoSettled(page, '/manage/comments')
    const id = await createComment(page, route.id, `${testPrefix} kurz`)
    await gotoSettled(page, '/manage/comments')

    const card = page.getByTestId(`comment-card-${id}`)
    await expect(card).toContainText('kurz')
    await expect(card.getByTestId('comment-card-toggle')).toHaveCount(0)
})

test('infinite scroll goes idle once every comment is loaded', async ({
    adminPage: page,
}) => {
    await page.addInitScript(() => {
        const observe = IntersectionObserver.prototype.observe
        IntersectionObserver.prototype.observe = function (target) {
            const counted = window as unknown as { observeCalls?: number }
            counted.observeCalls = (counted.observeCalls ?? 0) + 1
            return observe.call(this, target)
        }
    })
    await page.setViewportSize({ width: 1280, height: 4000 })
    await gotoSettled(page, '/manage/comments')

    const observeCalls = () =>
        page.evaluate(
            () =>
                (window as unknown as { observeCalls?: number }).observeCalls ??
                0,
        )
    let previous: number | null = null
    await expect
        .poll(
            async () => {
                const now = await observeCalls()
                const added = previous === null ? Infinity : now - previous
                previous = now
                return added
            },
            { intervals: [1_000], timeout: 15_000 },
        )
        .toBeLessThan(3)
})
