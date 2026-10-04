import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('lets a user download their data', async ({ createUser, pageAs }) => {
    const user = await createUser()
    const page = await pageAs(user)
    await gotoSettled(page, '/account/settings')

    await page.getByTestId('profile-tab-security').click()
    const download = page.waitForEvent('download')
    await page.getByTestId('account-export').click()

    expect((await download).suggestedFilename()).toMatch(
        /^gripello-data-\d{4}-\d{2}-\d{2}\.zip$/,
    )
})
