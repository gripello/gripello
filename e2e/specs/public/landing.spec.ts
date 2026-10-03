import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { E2E_GYM_SLUG } from '../../support/seed'

test('guests pick a gym on the landing page', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await gotoSettled(page, '/')

    const allGyms = page.getByTestId('landing-all-gyms')
    await expect(
        allGyms.getByTestId(`landing-gym-${E2E_GYM_SLUG}`),
    ).toBeVisible()
    await expect(page.getByTestId('landing-my-gyms')).toHaveCount(0)

    await page.getByTestId('landing-search').fill('no gym is called like this')
    await expect(page.getByTestId('landing-empty')).toBeVisible()

    await page.getByTestId('landing-search').fill('')
    await allGyms.getByTestId(`landing-gym-${E2E_GYM_SLUG}`).click()
    await page.waitForURL((url) => url.pathname === gymPath('/'))
    await expect(page.getByTestId('overview')).toBeVisible()
})

test('a visited gym shows up under recent gyms', async ({ page }) => {
    await gotoSettled(page, gymPath('/routes'))
    await gotoSettled(page, '/')
    await expect(
        page
            .getByTestId('landing-recent')
            .getByTestId(`landing-gym-${E2E_GYM_SLUG}`),
    ).toBeVisible()
})

test('staff see their gyms first', async ({ setterPage: page }) => {
    await gotoSettled(page, '/')
    await expect(
        page
            .getByTestId('landing-my-gyms')
            .getByTestId(`landing-gym-${E2E_GYM_SLUG}`),
    ).toBeVisible()
})

test('the gym switcher leads back to the gym picker', async ({
    userPage: page,
}) => {
    await gotoSettled(page, gymPath('/routes'))
    await page.locator('[data-testid="gym-switcher"]:visible').click()
    await page.getByTestId('gym-switcher-all').click()
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.getByTestId('landing')).toBeVisible()
})

test('tenant-less pages show the Gripello brand', async ({ page }) => {
    await gotoSettled(page, '/')
    const switcher = page.locator('[data-testid="gym-switcher"]:visible')
    await expect(switcher.getByTestId('nav-logo-custom')).toHaveCount(0)
    await expect(switcher.getByTestId('gym-switcher-name')).toHaveCount(0)
})

test('gym cards fit a 360px phone without sideways scrolling', async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await gotoSettled(page, '/')
    await expect(page.getByTestId('landing')).toBeVisible()
    expect(
        await page.evaluate(
            () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
        ),
    ).toBe(true)
})

test('an unknown gym slug answers 404', async ({ page }) => {
    const response = await page.goto('/no-such-gym-here/routes')
    expect(response?.status()).toBe(404)
})
