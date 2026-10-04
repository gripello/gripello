import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

const TOP_LEVEL = [
    'nav-link-home',
    'nav-link-map',
    'nav-link-routes',
    'nav-link-logbook',
    'nav-link-manage-routes',
]
const GROUPS = ['nav-group-manage', 'nav-group-admin']

test('the desktop sidebar lists every page in labelled sections', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    const sidebar = page.getByTestId('nav-desktop-links')
    await expect(sidebar).toBeVisible()
    for (const id of [...TOP_LEVEL, ...GROUPS]) {
        await expect(sidebar.getByTestId(id)).toBeVisible()
    }

    const sidebarBox = (await sidebar.boundingBox())!
    const mainBox = (await page.locator('#main-content').boundingBox())!
    expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(mainBox.x)
})

test('collapsing the sidebar keeps the icons and survives a reload', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    const sidebar = page.getByTestId('nav-sidebar')
    const widthOf = async () =>
        (await sidebar.locator('[data-slot="container"]').boundingBox())!.width

    const expanded = await widthOf()
    await page.getByTestId('nav-sidebar-toggle').click()
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
    await expect.poll(widthOf).toBeLessThan(expanded / 2)

    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    await expect(sidebar).toHaveAttribute('data-state', 'collapsed')

    await page.getByTestId('nav-sidebar-toggle').click()
    await expect(sidebar).toHaveAttribute('data-state', 'expanded')
})

test('only the section of the open page starts expanded', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    const sidebar = page.getByTestId('nav-desktop-links')

    await expect(sidebar.getByTestId('nav-link-manage-tasks')).toBeVisible()
    await expect(sidebar.getByTestId('nav-link-admin-settings')).toBeHidden()

    await sidebar.getByTestId('nav-group-admin').click()
    await expect(sidebar.getByTestId('nav-link-admin-settings')).toBeVisible()
})

test('section links navigate to their pages', async ({ adminPage: page }) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    await page.getByTestId('nav-group-moderation').click()
    await page.getByTestId('nav-link-manage-comments').click()
    await page.waitForURL('**/manage/comments')

    await page.getByTestId('nav-group-admin').click()
    await page.getByTestId('nav-link-admin-settings').click()
    await page.waitForURL('**/admin/settings')
})

test('the section label shows as active while one of its pages is open', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/inventory', /\/manage\/inventory/)

    await expect(page.getByTestId('nav-group-manage')).toHaveClass(
        /nav-link--active/,
    )
    await expect(page.getByTestId('nav-group-admin')).not.toHaveClass(
        /nav-link--active/,
    )
})

test('a group with no permitted page is left out entirely', async ({
    setterPage: page,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    await expect(page.getByTestId('nav-group-admin')).toHaveCount(0)
    await expect(page.getByTestId('nav-link-manage-routes')).toBeVisible()
})

const MOVED = [
    ['/admin/routes', gymPath('/manage/routes')],
    ['/admin/comments', gymPath('/manage/comments')],
    ['/admin/reports', gymPath('/manage/reports')],
    ['/admin/analytics', gymPath('/manage/analytics')],
    ['/admin/inventory', gymPath('/manage/inventory')],
    ['/admin/activity', '/account/activity'],
]

for (const [from, to] of MOVED) {
    test(`${from} redirects to ${to}`, async ({ adminPage: page }) => {
        const response = await page.goto(from)
        expect(response?.status()).toBe(200)
        expect(new URL(page.url()).pathname).toBe(to)
    })
}

test('the pages that stayed under /admin are still there', async ({
    adminPage: page,
}) => {
    for (const path of ['/admin/users', '/admin/settings']) {
        await gotoSettled(page, path, new RegExp(path))
        await expect(page.locator('h1')).toHaveCount(1)
    }
})
