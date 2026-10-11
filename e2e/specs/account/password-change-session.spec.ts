import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'

const NEW_PASSWORD = 'Chang3dPassw0rd!'

test('stays signed in after changing the own password', async ({
    page,
    createUser,
}) => {
    const user = await createUser('user', 'pw')

    await signInAs(page, user.email, user.password)
    await gotoSettled(page, '/account/settings')
    await page.getByTestId('profile-tab-security').click()

    await page.getByTestId('password-old').fill(user.password)
    await page.getByTestId('password-new').fill(NEW_PASSWORD)
    await page.getByTestId('password-confirm').fill(NEW_PASSWORD)
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('global-snackbar-message')).toBeVisible()
    await expect(page.getByTestId('password-new')).toHaveValue('')

    await gotoSettled(page, '/account')
    await expect(page.getByTestId('me-guest')).toHaveCount(0)
    await page.getByTestId('user-menu-activator').click()
    await expect(page.getByTestId('user-menu-profile')).toBeVisible()
})
