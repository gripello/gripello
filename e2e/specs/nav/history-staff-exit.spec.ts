import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

test('back to climbing returns to the route staff tools were opened from', async ({
    adminPage: page,
    route,
}) => {
    const routeUrl = `${gymPath('/route')}?id=${route.id}`
    await gotoSettled(page, routeUrl)
    await page.getByTestId('nav-staff-tools').click()
    await page.waitForURL(/\/manage(\/routes)?$/)
    await page.getByTestId('nav-link-manage-tasks').click()
    await page.waitForURL(/\/manage\/tasks$/)

    await page.getByTestId('nav-back-to-climbing').click()
    await expect(page).toHaveURL(routeUrl)
    await expect(page.getByTestId('nav-staff-tools')).toBeVisible()
})

test('back to climbing from a cold staff deep link opens the route list', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, gymPath('/manage/tasks'))
    await page.getByTestId('nav-back-to-climbing').click()
    await expect(page).toHaveURL(gymPath('/routes'))
})
