import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import {
    createRating,
    createRoute,
    deleteRoute,
    ensureLocations,
    routeInput,
    type Api,
} from '../../support/api'
import { uiaa } from '../../support/seed'
import type { RouteScoreRecord } from '../../../types/models'

async function seedRoute(api: Api, prefix: string, stars: number[]) {
    const locations = await ensureLocations(api)
    const route = await createRoute(
        api,
        routeInput(`${prefix}-stars`, locations['Hall A']!, uiaa('6')),
    )
    for (const rating of stars) {
        await createRating(api, route.id, {
            rating,
            ...uiaa('6'),
            comment: `${prefix} ${rating} stars`,
        })
    }
    return {
        api,
        routeId: route.id,
        cleanup: () => deleteRoute(api, route.id).catch(() => {}),
    }
}

test('a comment-only review does not pull down the average', async ({
    page,
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedRoute(adminApi, testPrefix, [4, 0])
    try {
        const score = await seeded.api.get<RouteScoreRecord>(
            `/routes/${seeded.routeId}`,
        )
        expect(score.average_rating).toBe(4)
        expect(score.ratings_count).toBe(1)

        await gotoSettled(page, `/route?id=${seeded.routeId}`)
        await expect(page.getByTestId('route-avg-rating')).toContainText('4')
        await expect(page.getByTestId('route-avg-rating')).not.toContainText(
            '2',
        )
    } finally {
        await seeded.cleanup()
    }
})

test('a new review cannot be submitted without stars', async ({
    page,
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedRoute(adminApi, testPrefix, [])
    try {
        await gotoSettled(page, `/route?id=${seeded.routeId}`)
        await page.getByTestId('review-open-cta').click()
        await page.getByTestId('review-form-difficulty').click()
        await page.getByRole('option').first().click()
        await expect(page.getByRole('listbox')).toBeHidden()
        await page
            .getByTestId('review-form-comment')
            .first()
            .fill('Only words, no stars')

        await expect(page.getByTestId('review-form-submit')).toBeDisabled()

        await page
            .getByTestId('review-form-rating')
            .locator('button, [role="radio"]')
            .nth(2)
            .click()
        await expect(page.getByTestId('review-form-submit')).toBeEnabled()
    } finally {
        await seeded.cleanup()
    }
})
