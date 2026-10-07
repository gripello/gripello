import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('staff get their own bottom bar and a way back to climbing', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await expect(page.getByTestId('nav-hamburger')).toHaveCount(0)
    await expect(page.getByTestId('nav-desktop-links')).toBeHidden()

    await page.getByTestId('bottom-nav-manage-tasks').click()
    await page.waitForURL('**/manage/tasks')
    await page.getByTestId('bottom-nav-manage').click()
    await page.waitForURL(/\/manage$/)
    await page.getByTestId('staff-hub-link-manage-comments').click()
    await page.waitForURL('**/manage/comments')

    await page.getByTestId('nav-back-to-climbing-mobile').click()
    await page.waitForURL(/\/routes$/)
    await expect(page.getByTestId('bottom-nav-feed')).toBeVisible()
})

test('the mobile filter button is big enough to show its icon', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')

    const filterButton = page.getByTestId('filter-open-sheet')
    await expect(filterButton).toBeVisible()

    const box = (await filterButton.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(28)
    expect(box.width).toBeGreaterThanOrEqual(28)
})
