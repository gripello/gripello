import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { getPlatformUser } from '../../support/api'

test('lets a user delete their own account', async ({
    api,
    createUser,
    pageAs,
}) => {
    const user = await createUser()
    const page = await pageAs(user)
    await gotoSettled(page, '/account/settings')

    await page.getByTestId('profile-tab-security').click()
    await page.getByTestId('profile-delete-open').click()
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await page.getByTestId('profile-delete-password').fill(user.password)
    await page.getByTestId('confirm-dialog-confirm').click()

    await page.waitForURL(/\/auth\/login/)

    await expect(getPlatformUser(api, user.id)).rejects.toThrow()
})
