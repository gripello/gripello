import { test, expect } from '../../support/fixtures'
import { createRating, updateRoute } from '../../support/api'
import { gotoSettled } from '../../support/nav'
import { uiaa } from '../../support/seed'

test('puts the route details beside the reviews under the header', async ({
    page,
    createRoute,
}) => {
    const route = await createRoute({ comment: 'Start sitzend' })
    await gotoSettled(page, `/route?id=${route.id}`)

    const bar = (await page.getByTestId('route-bar').boundingBox())!
    const details = (await page.getByTestId('route-details').boundingBox())!
    const reviews = (await page.getByTestId('route-reviews').boundingBox())!

    expect(bar.width).toBeGreaterThan(details.width * 2)
    expect(reviews.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1)
    expect(details.x).toBeGreaterThanOrEqual(reviews.x + reviews.width)
    expect(
        Math.abs(details.x + details.width - (bar.x + bar.width)),
    ).toBeLessThan(2)
})

test('reviews take the full width when there are no details', async ({
    page,
    createRoute,
}) => {
    const route = await createRoute({ anchor_point: 0 })
    await gotoSettled(page, `/route?id=${route.id}`)

    const bar = (await page.getByTestId('route-bar').boundingBox())!
    const reviews = (await page.getByTestId('route-reviews').boundingBox())!
    expect(Math.abs(reviews.width - bar.width)).toBeLessThan(2)
})

test('groups the grade card with the headline and keeps the name clear of the stats bar', async ({
    page,
    adminApi,
    route,
}) => {
    await updateRoute(adminApi, route.id, {
        name: 'Eckenflitzer mit sehr langem Routennamen am Überhang',
    })
    for (const width of [1024, 1920]) {
        await page.setViewportSize({ width, height: 800 })
        await gotoSettled(page, `/route?id=${route.id}`)

        const stats = (await page.getByTestId('route-stats').boundingBox())!
        const badge = (await page
            .getByTestId('route-grade-badge')
            .boundingBox())!
        const name = (await page.getByTestId('route-page-name').boundingBox())!
        const back = (await page.getByTestId('route-back').boundingBox())!
        const chip = (await page.getByTestId('route-type-chip').boundingBox())!

        const gap = badge.x - (name.x + name.width)
        expect(gap).toBeGreaterThanOrEqual(0)
        expect(gap).toBeLessThan(48)
        for (const box of [badge, name])
            expect(box.y + box.height).toBeLessThanOrEqual(stats.y)
        expect(Math.abs(stats.x - name.x)).toBeLessThan(2)
        expect(
            Math.abs(back.y + back.height / 2 - (chip.y + chip.height / 2)),
        ).toBeLessThan(4)
    }
})

test('the actions sit in the stats bar', async ({ page, route }) => {
    await gotoSettled(page, `/route?id=${route.id}`)

    const bar = (await page.getByTestId('route-bar').boundingBox())!
    const actions = (await page.getByTestId('route-actions').boundingBox())!
    expect(actions.y).toBeGreaterThanOrEqual(bar.y)
    expect(actions.y + actions.height).toBeLessThanOrEqual(bar.y + bar.height)
    expect(bar.x + bar.width - (actions.x + actions.width)).toBeLessThan(32)
})

test('a review comment lines up with the author name', async ({
    page,
    adminApi,
    route,
}) => {
    await createRating(adminApi, route.id, {
        rating: 4,
        comment:
            'Die Route ist komplett überbewertet, dafür 6b+ ist ein Witz. '.repeat(
                3,
            ),
        ...uiaa('7-'),
    })
    await createRating(adminApi, route.id, {
        rating: 0,
        grade: '',
        grade_system: '',
        grade_index: 0,
        comment: 'gut',
    })
    for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 800 })
        await gotoSettled(page, `/route?id=${route.id}`)

        const cards = page.locator('[id^="comment-"]')
        await expect(cards).toHaveCount(2)
        for (const card of await cards.all()) {
            const author = (await card
                .getByTestId('comment-card-author')
                .boundingBox())!
            const text = (await card
                .getByTestId('comment-card-comment')
                .boundingBox())!
            const box = (await card.boundingBox())!
            expect(Math.abs(text.x - author.x)).toBeLessThan(2)
            expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width)
        }
        await expect(
            page
                .getByTestId('comment-card-meta')
                .getByTestId('comment-card-perceived'),
        ).toContainText('7-')
    }
})
