import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test.use({ viewport: { width: 360, height: 740 } })

test('nested pages get a back arrow in the top bar, tab roots do not', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/account')
    await expect(page.getByTestId('nav-back')).toHaveCount(0)

    await gotoSettled(page, '/account/settings')
    await page.getByTestId('nav-back').click()
    await page.waitForURL(/\/account$/)
    await expect(page.getByTestId('nav-back')).toHaveCount(0)
})
