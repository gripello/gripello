import { test, expect } from '../../support/fixtures'
import { uiaa } from '../../support/seed'
import { createRoute } from '../../support/api'
import { gotoSettled } from '../../support/nav'
import { projectLanguage, translate } from '../../support/i18n'
import { seedMap, type SeededMap } from '../../support/map'

function checkedText(language: string, n: number) {
    const forms = translate(language, 'mapPlacement.checked', { n }).split(
        ' | ',
    )
    return n === 1 ? forms[0]! : forms[forms.length - 1]!
}

let seeded: SeededMap
let unplacedIds: string[]

test.beforeEach(async ({ adminApi, testPrefix }) => {
    seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    unplacedIds = []
    for (const index of [1, 2]) {
        const route = await createRoute(adminApi, {
            name: `${testPrefix}-unplaced-${index}`,
            ...uiaa('6'),
            location: seeded.locationId,
            anchor_point: 10 + index,
            type: 'Boulder',
            color: '#00ACC1',
            creator: ['E2E'],
            screw_date: '2026-09-01',
        })
        unplacedIds.push(route.id)
    }
    seeded.routeIds.push(...unplacedIds)
})

test.afterEach(async () => {
    await seeded.cleanup()
})

test('checked route count uses the plural form of the locale', async ({
    setterPage: page,
}, testInfo) => {
    const language = projectLanguage(testInfo)
    await gotoSettled(page, `/manage/map?location=${seeded.locationId}`)
    const check = (id: string) =>
        page
            .locator(`[data-testid="placement-route"][data-route-id="${id}"]`)
            .getByTestId('placement-route-check')

    await check(unplacedIds[0]!).click()
    await expect(page.getByTestId('placement-checked')).toContainText(
        checkedText(language, 1),
    )
    await check(unplacedIds[1]!).click()
    await expect(page.getByTestId('placement-checked')).toContainText(
        checkedText(language, 2),
    )
    await expect(page.getByTestId('placement-checked')).not.toContainText('|')
})

test('route card shows the translated route type', async ({
    page,
}, testInfo) => {
    const language = projectLanguage(testInfo)
    await gotoSettled(
        page,
        `/map?location=${seeded.locationId}&route=${seeded.routeIds[0]}`,
    )
    await expect(
        page.getByTestId('map-route-card').getByTestId('route-card-type'),
    ).toHaveText(translate(language, 'routes.types.boulder'))
})

test('map dots name the route colour in the active locale', async ({
    page,
    testPrefix,
}, testInfo) => {
    const language = projectLanguage(testInfo)
    await gotoSettled(page, `/map?location=${seeded.locationId}`)
    await expect(
        page.locator(
            `[data-testid="map-route-dot"][data-route-id="${seeded.routeIds[0]}"]`,
        ),
    ).toHaveAttribute(
        'aria-label',
        `${testPrefix}-map-route-1, ${translate(language, 'colors.red')}`,
    )
})
