import { test, expect } from '../../support/fixtures'
import { createRoute } from '../../support/api'
import { uiaa } from '../../support/seed'
import { gotoSettled } from '../../support/nav'
import {
    centerOf,
    seedMap,
    settledBox,
    touchInput,
    type SeededMap,
} from '../../support/map'

let seeded: SeededMap
let unplacedIds: string[]

test.beforeEach(async ({ adminApi, testPrefix }) => {
    seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    unplacedIds = []
    for (const index of [1, 2]) {
        const route = await createRoute(adminApi, {
            name: `${testPrefix}-phone-${index}`,
            ...uiaa('6'),
            location: seeded.locationId,
            anchor_point: 20 + index,
            type: 'Boulder',
            creator: ['E2E'],
        })
        unplacedIds.push(route.id)
    }
})

test('on a phone routes are placed one after another by tapping walls', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    await expect(page.getByTestId('map-zoom-in')).toBeVisible()

    await page
        .locator(
            `[data-testid="placement-route"][data-route-id="${unplacedIds[0]}"]`,
        )
        .tap()
    const north = page.getByRole('button', {
        name: `${testPrefix} North`,
        exact: true,
    })
    await north.tap()
    await expect(page.getByTestId('placement-hint')).toContainText(
        `${testPrefix}-phone-2`,
    )
    await north.tap({ position: { x: 20, y: 5 } })

    for (const id of unplacedIds)
        await expect(
            page.locator(
                `[data-testid="placement-dot"][data-route-id="${id}"]`,
            ),
        ).toBeVisible()
})

test('on a phone a long press on a route drags it onto a wall', async ({
    setterPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    const from = centerOf(
        await settledBox(
            page.locator(
                `[data-testid="placement-route"][data-route-id="${unplacedIds[0]}"]`,
            ),
        ),
    )
    const touch = await touchInput(page)
    await touch('touchStart', from)
    await expect(page.getByTestId('placement-drag-ghost')).toBeVisible()

    const to = centerOf(
        await settledBox(
            page
                .locator(
                    `[data-testid="placement-wall"][data-name="${testPrefix} North"]`,
                )
                .getByTestId('placement-wall-outline'),
        ),
    )
    for (let step = 1; step <= 8; step++)
        await touch('touchMove', {
            x: Math.round(from.x + ((to.x - from.x) * step) / 8),
            y: Math.round(from.y + ((to.y - from.y) * step) / 8),
        })
    await touch('touchEnd')

    await expect(
        page.locator(
            `[data-testid="placement-dot"][data-route-id="${unplacedIds[0]}"]`,
        ),
    ).toBeVisible()
    await expect(page.getByTestId('placement-save')).toContainText('1')
})
