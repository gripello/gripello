import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { E2E_GYM_SLUG, e2eGymId } from '../../support/seed'

test.beforeEach(async ({ page }) => {
    await page.route('https://tile.openstreetmap.org/**', (route) =>
        route.abort(),
    )
})

test('staff save opening hours and the info page shows them', async ({
    adminPage: page,
    root,
}) => {
    await gotoSettled(page, '/admin/settings?section=info')
    const description = `E2E gym ${Date.now()}`
    await page.getByTestId('settings-info-description').fill(description)
    await page.getByTestId('opening-hours-mon-add').click()
    await page.getByTestId('opening-hours-mon-0-opens').fill('07:00')
    await page.getByTestId('opening-hours-mon-0-closes').fill('23:00')
    await page.getByTestId('opening-hours-copy-monday').click()
    await expect(page.getByTestId('opening-hours-fri-0-opens')).toHaveValue(
        '07:00',
    )
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-save')).toBeHidden()

    const gym = await root.collection('gyms').getOne(await e2eGymId(root))
    expect(gym.description).toBe(description)
    expect(gym.opening_hours.mon).toEqual([['07:00', '23:00']])
    expect(gym.opening_hours.fri).toEqual([['07:00', '23:00']])

    await gotoSettled(page, gymPath('/info'))
    await expect(page.getByTestId('gym-info-description')).toHaveText(
        description,
    )
    await expect(page.getByTestId('gym-info-hours')).toContainText(
        '07:00–23:00',
    )
    await expect(page.getByTestId('gym-info-status')).toBeVisible()
})

test('the info page and the landing map show the gym location after consent', async ({
    page,
    root,
}) => {
    await root.collection('gyms').update(await e2eGymId(root), {
        latitude: 52.52,
        longitude: 13.405,
        address: 'Hauptstr. 1\n10115 Berlin',
        amenities: ['showers', 'toilets'],
    })

    await gotoSettled(page, gymPath('/info'))
    await expect(page.getByTestId('gym-amenity-showers')).toBeVisible()
    await expect(page.getByTestId('gym-amenity-toilets')).toBeVisible()
    await expect(page.getByTestId('gym-directions')).toHaveAttribute(
        'href',
        /destination=52\.52,13\.405/,
    )
    const map = page.getByTestId('gym-location-map')
    await expect(map.locator('.gym-map-pin')).toHaveCount(0)
    await map.getByTestId('gym-map-consent').click()
    await expect(map.locator('.gym-map-pin')).toHaveCount(1)

    await gotoSettled(page, '/')
    const landingMap = page.getByTestId('gym-location-map')
    await expect(landingMap.locator('.gym-map-pin')).not.toHaveCount(0)
    await landingMap.locator('.gym-map-pin').first().click()
    const card = landingMap.getByTestId('gym-map-card')
    await expect(card).toContainText('Hauptstr. 1')
    await card.getByTestId('gym-map-card-open').click()
    await page.waitForURL((url) => url.pathname === `/${E2E_GYM_SLUG}`)
})
