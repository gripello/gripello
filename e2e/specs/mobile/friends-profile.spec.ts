import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test.use({ viewport: { width: 360, height: 740 } })

test('the friends tab shows my profile card on phones', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/friends')
    await page.getByTestId('friends-my-profile').click()
    await expect(page).toHaveURL(/\/climber\?id=/)
})
