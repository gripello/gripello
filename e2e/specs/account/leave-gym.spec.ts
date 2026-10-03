import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { E2E_GYM_SLUG } from '../../support/seed'

test('a setter leaves the gym and loses the staff pages', async ({
    createUser,
    pageAs,
}) => {
    const setter = await createUser('routesetter', 'leaver')
    const page = await pageAs(setter)
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoSettled(page, '/account')
    await expect(page.getByTestId('me-staff-manage-routes')).toBeVisible()

    await page.getByTestId(`me-gym-leave-${E2E_GYM_SLUG}`).click()
    await page.getByTestId('confirm-dialog-confirm').click()

    await expect(page.getByTestId(`me-gym-${E2E_GYM_SLUG}`)).toHaveCount(0)
    await expect(page.getByTestId('me-gyms-empty')).toBeVisible()
    await expect(page.getByTestId('me-staff-manage-routes')).toHaveCount(0)
})
