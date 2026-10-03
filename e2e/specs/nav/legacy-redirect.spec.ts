import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

test('old tenant paths redirect into the gym from the cookie', async ({
    page,
}) => {
    for (const [from, to] of [
        ['/routes', gymPath('/routes')],
        ['/map?location=x', gymPath('/map?location=x')],
        ['/manage/tasks', gymPath('/manage/tasks')],
        ['/competitions', gymPath('/competitions')],
        ['/admin/routes', gymPath('/manage/routes')],
    ]) {
        const response = await page.request.get(from!, { maxRedirects: 0 })
        expect(response.status(), from).toBe(302)
        expect(response.headers().location!.endsWith(to!), from).toBe(true)
    }
})

test('the gym cookie decides where old paths lead', async ({ request }) => {
    const response = await request.get('/routes', {
        maxRedirects: 0,
        headers: { cookie: 'gym=some-other-gym' },
    })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toContain('/some-other-gym/routes')
})

test('a bookmarked manage page still opens for staff', async ({
    setterPage: page,
}) => {
    await gotoSettled(page, '/manage/routes', /\/manage\/routes/)
    expect(new URL(page.url()).pathname).toBe(gymPath('/manage/routes'))
    await expect(page.getByTestId('nav-link-manage-routes')).toBeVisible()
})

test('gym pages remember the gym in a cookie', async ({ page }) => {
    await gotoSettled(page, gymPath('/map'))
    const cookie = (await page.context().cookies()).find(
        (entry) => entry.name === 'gym',
    )
    expect(cookie?.value).toBe(gymPath('/').slice(1))
    expect(cookie?.sameSite).toBe('Lax')
})

test('without a cookie old paths go to the only gym or the picker', async ({
    browser,
    baseURL,
}) => {
    const context = await browser.newContext({
        baseURL,
        ignoreHTTPSErrors: true,
    })
    try {
        const response = await context.request.get('/routes', {
            maxRedirects: 0,
        })
        expect(response.status()).toBe(302)
        const target = new URL(response.headers().location!, baseURL)
        expect(['/', gymPath('/routes')]).toContain(target.pathname)
    } finally {
        await context.close()
    }
})
