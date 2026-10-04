import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { uiaa } from '../../support/seed'

test('switching to another route via the command palette shows that route', async ({
    page,
    createRoute,
}) => {
    const first = await createRoute()
    const second = await createRoute()
    await gotoSettled(page, `/route?id=${first.id}`)
    await expect(page.getByTestId('route-page-name')).toHaveText(first.name)

    await page.getByTestId('command-palette-open').click()
    const input = page.getByTestId('command-palette-input')
    await input.fill(second.name)
    await expect(
        page.getByTestId('command-palette-result').first(),
    ).toContainText(second.name)
    await input.press('Enter')

    await page.waitForURL(new RegExp(`id=${second.id}`))
    await expect(page.getByTestId('route-page-name')).toHaveText(second.name)
})

test.describe('french locale', () => {
    test.use({ locale: 'fr-FR' })

    test('shows the translated route type', async ({ page, route }) => {
        await gotoSettled(page, `/route?id=${route.id}`)
        await expect(page.getByTestId('route-type-chip')).toHaveText('Voie')
    })
})

test.describe('german locale', () => {
    test.use({ locale: 'de-DE' })

    test('formats the average rating with a decimal comma', async ({
        page,
        root,
        route,
        testPrefix,
    }) => {
        for (const rating of [4, 5]) {
            await root.collection('ratings').create({
                route_id: route.id,
                rating,
                ...uiaa('5'),
                comment: `${testPrefix}-rated`,
            })
        }
        await gotoSettled(page, `/route?id=${route.id}`)
        await expect(page.getByTestId('route-avg-rating')).toContainText(
            /\d,\d/,
        )
    })
})
