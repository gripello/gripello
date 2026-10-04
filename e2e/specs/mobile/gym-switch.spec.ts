import { test, expect } from '../../support/fixtures'
import { assertSettledUrl, gotoSettled, gymPath } from '../../support/nav'

test('climbers switch gyms from the header', async ({ page, root }) => {
    const slug = `e2e-switch-${Date.now()}`
    const other = await root
        .collection('gyms')
        .create({ slug, name: 'E2E Switch Gym', active: true })
    try {
        await gotoSettled(page, `/${slug}/routes`)
        await gotoSettled(page, gymPath('/map'))

        const switcher = page.locator('[data-testid="gym-switcher"]:visible')
        await expect(switcher.getByTestId('gym-switcher-name')).toBeVisible()
        await switcher.click()
        await page.getByTestId(`gym-switcher-item-${slug}`).click()
        await assertSettledUrl(page, (url) => url.pathname === `/${slug}/map`)
        await expect(
            page
                .locator('[data-testid="gym-switcher"]:visible')
                .getByTestId('gym-switcher-name'),
        ).toHaveText('E2E Switch Gym')

        await page.locator('[data-testid="gym-switcher"]:visible').click()
        await page.getByTestId('gym-switcher-all').click()
        await page.waitForURL((url) => url.pathname === '/')
        await expect(page.getByTestId('landing')).toBeVisible()
    } finally {
        await root.collection('gyms').delete(other.id)
    }
})
