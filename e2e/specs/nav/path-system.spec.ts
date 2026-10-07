import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

test('the desktop sidebar splits gym, community and you', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, gymPath('/routes'))

    const sidebar = page.getByTestId('nav-desktop-links')
    await expect(sidebar).toBeVisible()
    for (const id of [
        'nav-link-home',
        'nav-link-routes',
        'nav-link-map',
        'nav-link-feed',
        'nav-link-friends',
        'nav-link-logbook',
        'nav-link-climber',
    ]) {
        await expect(sidebar.getByTestId(id)).toBeVisible()
    }
    await expect(sidebar.getByTestId('nav-link-manage-routes')).toHaveCount(0)

    const sidebarBox = (await sidebar.boundingBox())!
    const mainBox = (await page.locator('#main-content').boundingBox())!
    expect(sidebarBox.x + sidebarBox.width).toBeLessThanOrEqual(mainBox.x)
})

test('staff tools open a separate workspace with a way back', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, gymPath('/routes'))
    await page.getByTestId('nav-staff-tools').click()
    await page.waitForURL(/\/manage$/)
    await expect(page.getByTestId('staff-hub')).toBeVisible()
    const sidebar = page.getByTestId('nav-desktop-links')
    await expect(sidebar.getByTestId('nav-link-manage-tasks')).toBeVisible()
    await expect(sidebar.getByTestId('nav-link-admin-settings')).toBeVisible()
    await expect(sidebar.getByTestId('nav-link-feed')).toHaveCount(0)

    await page.getByTestId('nav-back-to-climbing').click()
    await page.waitForURL(/\/routes$/)
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

test('staff links navigate to their pages', async ({ adminPage: page }) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    await page.getByTestId('nav-link-manage-comments').click()
    await page.waitForURL('**/manage/comments')
    await expect(page.getByTestId('nav-link-manage-comments')).toHaveClass(
        /nav-link--active/,
    )

    await page.getByTestId('nav-link-admin-settings').click()
    await page.waitForURL('**/admin/settings')
})

test('a staff section with no permitted page is left out entirely', async ({
    setterPage: page,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)

    await expect(page.getByTestId('nav-link-admin-settings')).toHaveCount(0)
    await expect(page.getByTestId('nav-link-manage-routes')).toBeVisible()
})

const MOVED = [
    ['/admin/routes', gymPath('/manage/routes')],
    ['/admin/comments', gymPath('/manage/comments')],
    ['/admin/reports', gymPath('/manage/moderation')],
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

test.describe('on a touch tablet', () => {
    test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } })

    test('a tap on a collapsed staff icon opens its page', async ({
        adminPage: page,
    }) => {
        await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
        const sidebar = page.getByTestId('nav-sidebar')
        if ((await sidebar.getAttribute('data-state')) !== 'collapsed')
            await page.getByTestId('nav-sidebar-toggle').tap()
        await expect(sidebar).toHaveAttribute('data-state', 'collapsed')

        await page
            .getByTestId('nav-desktop-links')
            .getByRole('link', { name: 'Users' })
            .tap()
        await page.waitForURL('**/admin/users')
    })
})
