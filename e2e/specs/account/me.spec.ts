import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

test('guests are invited to sign in', async ({ page }) => {
    await gotoSettled(page, '/account')
    await expect(page.getByTestId('me-guest')).toBeVisible()
    await page.getByTestId('me-login').click()
    await page.waitForURL(/\/auth\/login\?redirect=(%2F|\/)account/)
})

test('climbers see a personal account page', async ({ userPage: page }) => {
    await gotoSettled(page, '/account')
    await expect(page.getByTestId('me-name')).toBeVisible()
    await expect(page.getByTestId('me-friends')).toBeVisible()
    await page.getByTestId('me-profile').click()
    await page.waitForURL(/\/account\/settings$/)
    await expect(page.getByTestId('profile-firstname')).toBeVisible()
})

test('on phones staff reach the staff workspace from the You tab', async ({
    setterPage: page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoSettled(page, '/account')
    await page.getByTestId('me-staff-tools').click()
    await page.waitForURL(/\/manage$/)
    await expect(page.getByTestId('staff-hub-link-manage-map')).toBeVisible()
    await expect(page.getByTestId('staff-hub-admin')).toHaveCount(0)
    await page.getByTestId('bottom-nav-manage-routes').click()
    await page.waitForURL(/\/manage\/routes$/)
})

test('on phones section tabs switch between the gym pages', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoSettled(page, gymPath('/routes'))
    await page.getByTestId('section-tab-map').click()
    await page.waitForURL(/\/map$/)
    await page.getByTestId('bottom-nav-feed').click()
    await page.waitForURL(/\/feed$/)
    await page.getByTestId('section-tab-leaderboard').click()
    await page.waitForURL(/\/leaderboard$/)
})
