import { test, expect } from '../../support/fixtures'
import { gymPath } from '../../support/nav'

test('server-renders the favicon, logo and logged-out navbar', async ({
    page,
}) => {
    const response = await page.goto(gymPath('/'))
    const html = (await response?.text()) ?? ''

    expect(html).toMatch(/<link[^>]+rel="icon"[^>]+href="[^"]+"/)
    expect(html).toMatch(
        /data-testid="nav-logo"[^>]*>[\s\S]{0,120}?<img[^>]+alt="(?!Logo")[^"]+"/,
    )
    expect(html).toContain('data-testid="nav-login"')
    expect(html).not.toMatch(/verti-grade/i)
})

test('server-renders the logged-in navbar', async ({ adminPage: page }) => {
    const response = await page.goto('/manage/routes')
    const html = (await response?.text()) ?? ''

    expect(html).toContain('data-testid="user-menu-activator"')
    expect(html).toContain('data-testid="bottom-nav"')
    expect(html).toContain('data-testid="nav-back-to-climbing"')
    expect(html).toContain('data-testid="nav-link-admin-settings"')
})

test('the navbar logo actually loads', async ({ page }) => {
    await page.goto(gymPath('/'))

    const logo = page.getByTestId('nav-logo').locator('img:visible')
    await expect(logo).toBeVisible()

    await expect
        .poll(async () =>
            logo.evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBeGreaterThan(0)

    const src = (await logo.getAttribute('src')) ?? ''
    if (src.includes('api/files')) expect(src).not.toContain('_ipx')
})
