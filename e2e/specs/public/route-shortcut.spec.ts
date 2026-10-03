import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

test('a printed QR link opens the route in its gym', async ({
    page,
    route,
}) => {
    const response = await page.request.get(`/route?id=${route.id}`, {
        maxRedirects: 0,
    })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toContain(
        `${gymPath('/route')}?id=${route.id}`,
    )

    await gotoSettled(page, `/route?id=${route.id}`)
    await page.waitForURL((url) => url.pathname === gymPath('/route'))
    expect(new URL(page.url()).searchParams.get('id')).toBe(route.id)
})

test('an unknown route id answers 404', async ({ page }) => {
    const response = await page.goto('/route?id=doesnotexist123')
    expect(response?.status()).toBe(404)
})
