import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('the route form sheet sits flush and shifts nothing behind it', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 393, height: 852 })
    await gotoSettled(page, '/manage/routes')

    await expect
        .poll(
            () =>
                page.evaluate(
                    () =>
                        document.documentElement.scrollHeight >
                        document.documentElement.clientHeight,
                ),
            { message: 'the list must scroll for this to be a real test' },
        )
        .toBe(true)

    const anchors = async () => {
        const logo = (await page
            .getByTestId('nav-back-to-climbing-mobile')
            .boundingBox())!
        const search = (await page.getByTestId('filter-search').boundingBox())!
        return [logo.x, search.x, search.width]
    }

    const before = await anchors()
    await page.getByTestId('routes-create-open').click()
    const sheet = page.getByTestId('route-form-dialog')
    await expect(sheet).toBeVisible()
    await expect
        .poll(async () =>
            Math.max(
                ...(await anchors()).map((value, index) =>
                    Math.abs(value - before[index]!),
                ),
            ),
        )
        .toBeLessThan(0.5)

    await expect
        .poll(async () => {
            const box = await sheet.boundingBox()
            return box && { x: box.x, width: box.width }
        })
        .toEqual({ x: 0, width: 393 })
})
