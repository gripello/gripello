import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

test.describe('tablet landscape without bottom nav', () => {
    test.use({ viewport: { width: 1180, height: 820 } })

    test('leaves no empty space for the hidden bottom nav', async ({
        page,
    }) => {
        await gotoSettled(page, gymPath('/'))
        await expect(page.getByTestId('bottom-nav')).toBeHidden()
        await expect(page.locator('#main-content')).toHaveCSS(
            'padding-bottom',
            '0px',
        )
    })
})

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('reserves space for the bottom nav', async ({ page }) => {
        await gotoSettled(page, gymPath('/'))
        await expect(page.getByTestId('bottom-nav')).toBeVisible()
        await expect(page.locator('#main-content')).not.toHaveCSS(
            'padding-bottom',
            '0px',
        )
    })
})
