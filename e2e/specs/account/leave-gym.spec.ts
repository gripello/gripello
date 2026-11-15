import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { membershipOf } from '../../support/api'
import { E2E_GYM_SLUG } from '../../support/seed'

test('a setter leaves the gym and loses the staff pages', async ({
    createUser,
    pageAs,
    adminApi,
}) => {
    const setter = await createUser('routesetter', 'leaver')
    const page = await pageAs(setter)
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoSettled(page, '/account')
    await expect(page.getByTestId('me-staff-tools')).toBeVisible()

    await page.getByTestId(`me-gym-leave-${E2E_GYM_SLUG}`).click()
    await page.getByRole('menuitem', { name: 'Leave' }).click()
    await page.getByTestId('confirm-dialog-confirm').click()

    await expect(page.getByTestId(`me-gym-${E2E_GYM_SLUG}`)).toHaveCount(0)
    await expect(page.getByTestId('me-gyms-empty')).toBeVisible()
    await expect(page.getByTestId('me-staff-tools')).toHaveCount(0)
    expect(await membershipOf(adminApi, setter.id)).toBeNull()
    await gotoSettled(page, '/manage/routes')
    await expect(page).not.toHaveURL(/\/manage\//)
})
