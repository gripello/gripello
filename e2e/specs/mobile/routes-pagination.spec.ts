import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('paginates the mobile route card list', async ({
    adminPage: page,
    createRoute,
    testPrefix,
}) => {
    await Promise.all(Array.from({ length: 12 }, () => createRoute()))

    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(testPrefix)
    await expect(page.getByTestId('routes-row')).toHaveCount(12)
    await expect(page.getByTestId('routes-mobile-pagination')).toBeVisible()

    await page.getByTestId('routes-mobile-page-size').click()
    const routesResponse = page.waitForResponse((res) =>
        /\/api\/gyms\/[^/]+\/routes$/.test(new URL(res.url()).pathname),
    )
    await page.getByRole('option', { name: '10', exact: true }).click()
    await routesResponse
    await expect(page.getByTestId('routes-row')).toHaveCount(10)

    await expect(page.getByTestId('routes-mobile-goto-1')).toHaveAttribute(
        'aria-current',
        'page',
    )
    await expect(page.getByTestId('routes-mobile-prev')).toBeDisabled()

    await page.getByTestId('routes-mobile-next').click()
    await expect(page.getByTestId('routes-mobile-goto-2')).toHaveAttribute(
        'aria-current',
        'page',
    )
    await expect(page.getByTestId('routes-row')).toHaveCount(2)
    await expect(page.getByTestId('routes-mobile-next')).toBeDisabled()

    await page.getByTestId('routes-mobile-goto-1').click()
    await expect(page.getByTestId('routes-mobile-goto-1')).toHaveAttribute(
        'aria-current',
        'page',
    )
    await expect(page.getByTestId('routes-row')).toHaveCount(10)
})

test('the pager stays under the thumb while stepping', async ({
    adminPage: page,
    createRoute,
    testPrefix,
}) => {
    await Promise.all(Array.from({ length: 30 }, () => createRoute()))

    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(testPrefix)
    await page.getByTestId('routes-mobile-page-size').click()
    await page.getByRole('option', { name: '10', exact: true }).click()
    await expect(page.getByTestId('routes-mobile-goto-3')).toBeVisible()

    const next = page.getByTestId('routes-mobile-next')
    await next.click()
    await expect(page.getByTestId('routes-mobile-goto-2')).toHaveAttribute(
        'aria-current',
        'page',
    )
    const afterFirst = (await next.boundingBox())!

    await next.click()
    await expect(page.getByTestId('routes-mobile-goto-3')).toHaveAttribute(
        'aria-current',
        'page',
    )
    await expect
        .poll(async () => {
            const box = (await next.boundingBox())!
            return [Math.round(box.x), Math.round(box.y)]
        })
        .toEqual([Math.round(afterFirst.x), Math.round(afterFirst.y)])
})
