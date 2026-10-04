import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

for (const path of [
    '/manage/routes',
    '/map',
    '/scan',
    '/account',
    '/account/settings',
    '/account/settings?tab=notifications',
]) {
    test(`${path} fits the phone width`, async ({ adminPage: page }) => {
        await gotoSettled(page, path)
        const overflow = await page.evaluate(
            () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
        )
        expect(overflow).toBeLessThanOrEqual(1)
    })
}

test('the guest header keeps sign-in on screen at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await gotoSettled(page, '/map')

    const login = page.getByTestId('nav-login')
    await expect(login).toHaveAccessibleName(/.+/)
    const box = (await login.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(360)
    expect(box.height).toBeLessThanOrEqual(44)
})

test('the active account settings tab is scrolled into view', async ({
    adminPage: page,
}) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await gotoSettled(page, '/account/settings?tab=security')

    await expect
        .poll(async () => {
            const box = (await page
                .getByTestId('profile-tab-security')
                .boundingBox())!
            return box.x >= 0 && box.x + box.width <= 360
        })
        .toBe(true)
})
