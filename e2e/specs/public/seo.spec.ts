import { test, expect } from '../../support/fixtures'
import { gymPath } from '../../support/nav'

const descriptionOf = (html: string) =>
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/)?.[1] ?? ''
const noindex = (html: string) =>
    /<meta[^>]+name="robots"[^>]+content="noindex"/.test(html)

const PUBLIC = [
    '/',
    gymPath('/'),
    gymPath('/routes'),
    gymPath('/map'),
    gymPath('/info'),
    gymPath('/competitions'),
    gymPath('/leaderboard'),
    gymPath('/imprint'),
    gymPath('/privacy'),
    '/imprint',
    '/privacy',
    '/auth/login',
]

for (const path of PUBLIC) {
    test(`${path} carries a meta description`, async ({ page }) => {
        const html = (await (await page.goto(path))?.text()) ?? ''
        expect(descriptionOf(html).trim().length).toBeGreaterThan(20)
    })
}

test('indexes public gym pages and keeps app-only pages out', async ({
    page,
}) => {
    for (const path of [gymPath('/'), gymPath('/routes'), '/'])
        expect(noindex((await (await page.goto(path))?.text()) ?? '')).toBe(
            false,
        )
    for (const path of ['/auth/login', '/scan', gymPath('/tv')])
        expect(noindex((await (await page.goto(path))?.text()) ?? '')).toBe(
            true,
        )
})

test('serves robots.txt with a cache header', async ({ request }) => {
    const response = await request.get('/robots.txt')
    expect(response.ok()).toBe(true)
    expect(await response.text()).toContain('Disallow: /*/manage/')
    expect(response.headers()['cache-control']).toBe('public, max-age=3600')
})
