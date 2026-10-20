import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

const SM = 640

for (const width of [360, 663, 768, 1024, 1440, 1920]) {
    test(`the route page lines up at ${width}px`, async ({
        page,
        createRoute,
    }) => {
        const route = await createRoute({ comment: 'Start sitzend' })
        await page.setViewportSize({ width, height: 900 })
        await gotoSettled(page, `/route?id=${route.id}`)

        const overflow = await page.evaluate(
            () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
        )
        expect(overflow).toBeLessThanOrEqual(1)

        const box = async (id: string) =>
            (await page.getByTestId(id).boundingBox())!
        const hero = await box('route-hero')
        const bar = await box('route-bar')
        const stats = await box('route-stats')
        const reviews = await box('route-reviews')

        expect(stats.x).toBeGreaterThanOrEqual(0)
        expect(stats.x + stats.width).toBeLessThanOrEqual(width)
        expect(bar.y).toBeLessThan(hero.y + hero.height)

        if (width >= SM) {
            for (const other of [bar, reviews]) {
                expect(Math.abs(other.x - hero.x)).toBeLessThan(2)
            }
            expect(
                Math.abs(bar.x + bar.width - (hero.x + hero.width)),
            ).toBeLessThan(2)
        }
        if (width < 1024) {
            const details = await box('route-details')
            expect(Math.abs(details.x - reviews.x)).toBeLessThan(2)
            expect(Math.abs(details.width - reviews.width)).toBeLessThan(2)
            await page.getByTestId('route-reviews').scrollIntoViewIfNeeded()
            await expect(page.getByTestId('route-reviews')).toBeInViewport()
        }
    })
}
