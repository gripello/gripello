import { test, expect } from '../../support/fixtures'
import { gymPath } from '../../support/nav'

test('server-renders the public route list', async ({ page }) => {
    const response = await page.goto('/routes')
    expect((await response?.text()) ?? '').toContain('data-testid="route-card-')
})

test('server-renders a route detail page', async ({ page, route }) => {
    const { id, name } = route

    const response = await page.goto(`/route?id=${id}`)
    const html = (await response?.text()) ?? ''

    expect(html).toContain('data-testid="route-page-name"')
    expect(html).toContain(name)
    expect(html).toMatch(new RegExp(`<title>[^<]*${name}[^<]*</title>`))
})

test.describe('admin pages', () => {
    for (const path of [
        '/manage/routes',
        '/manage/comments',
        '/admin/users',
        '/manage/analytics',
    ]) {
        test(`server-renders ${path}`, async ({ adminPage: page }) => {
            const response = await page.goto(path)
            expect(response?.status()).toBe(200)
            expect(page.url()).toContain(path)
            expect((await response?.text()) ?? '').not.toContain(
                'data-testid="login-form"',
            )
        })
    }
})

test('never ships internal-host file urls in the server html', async ({
    adminPage: page,
}) => {
    for (const path of [
        '/admin/users',
        '/manage/comments',
        '/admin/settings',
    ]) {
        const response = await page.goto(path)
        expect((await response?.text()) ?? '').not.toContain('localhost:8080')
    }
})

test('redirects a guarded page on the server, without rendering it', async ({
    page,
}) => {
    const response = await page.goto('/manage/routes')
    expect(page.url()).toContain('/auth/login')
    expect((await response?.text()) ?? '').not.toContain(
        'data-testid="routes-table"',
    )
})

test('server-renders the notification bell for signed-in users', async ({
    userPage: page,
}) => {
    const response = await page.goto(gymPath('/'))
    expect((await response?.text()) ?? '').toContain(
        'data-testid="notification-bell"',
    )
})
