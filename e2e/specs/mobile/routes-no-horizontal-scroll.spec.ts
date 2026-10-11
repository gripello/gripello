import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, searchRoutes } from '../../support/nav'

const horizontalOverflow = (page: Page) =>
    page.evaluate(() => {
        const el = document.documentElement
        return el.scrollWidth - el.clientWidth
    })

test.use({ viewport: { width: 375, height: 667 } })

test('the route manager never scrolls sideways on a small phone', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')

    const pagination = page.getByTestId('routes-mobile-pagination')
    await expect(pagination).toBeVisible()
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1)
    await expect
        .poll(async () => {
            const box = (await pagination.boundingBox())!
            return box.x + box.width
        })
        .toBeLessThanOrEqual(375)
})

test('the page strip keeps its ends in view on a small phone', async ({
    adminPage: page,
    createRoute,
    testPrefix,
}) => {
    await Promise.all(Array.from({ length: 60 }, () => createRoute()))

    await gotoSettled(page, '/manage/routes')
    await searchRoutes(page, testPrefix)
    await page.getByTestId('routes-mobile-page-size').click()
    const routesResponse = page.waitForResponse((res) =>
        /\/api\/gyms\/[^/]+\/routes$/.test(new URL(res.url()).pathname),
    )
    await page.getByRole('option', { name: '10', exact: true }).click()
    await routesResponse
    await expect(page.getByTestId('routes-row')).toHaveCount(10)
    await expect(page.getByTestId('routes-mobile-goto-6')).toBeVisible()
    await expect(page.getByTestId('routes-mobile-goto-7')).toHaveCount(0)

    await page.getByTestId('routes-mobile-next').click()
    await expect(page.getByTestId('routes-mobile-goto-2')).toHaveAttribute(
        'aria-current',
        'page',
    )
    await page.getByTestId('routes-mobile-next').click()
    await expect(page.getByTestId('routes-mobile-goto-3')).toHaveAttribute(
        'aria-current',
        'page',
    )

    await expect(page.getByTestId('routes-mobile-goto-1')).toBeVisible()
    await expect(page.getByTestId('routes-mobile-goto-6')).toBeVisible()
    await expect(
        page.getByTestId('routes-mobile-page-gap').first(),
    ).toBeVisible()
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1)
})
