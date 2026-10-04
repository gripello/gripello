import { test, expect } from '../../support/fixtures'
import { gymPath } from '../../support/nav'

test.use({ launchOptions: { args: ['--ignore-certificate-errors'] } })

test('links an installable web app manifest', async ({ page, request }) => {
    const response = await page.goto(gymPath('/'))
    const html = (await response?.text()) ?? ''

    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain(
        'rel="apple-touch-icon" href="/apple-touch-icon.png"',
    )

    const manifestResponse = await request.get('/manifest.webmanifest')
    expect(manifestResponse.ok()).toBe(true)
    const manifest = await manifestResponse.json()

    expect(manifest.name).toBe('Gripello')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    const iconSizes = manifest.icons.map(
        (icon: { sizes: string }) => icon.sizes,
    )
    expect(iconSizes).toEqual(expect.arrayContaining(['192x192', '512x512']))

    for (const src of [
        ...manifest.icons.map((icon: { src: string }) => icon.src),
        '/apple-touch-icon.png',
    ]) {
        const iconResponse = await request.get(src)
        expect(iconResponse.ok(), src).toBe(true)
        expect(iconResponse.headers()['content-type']).toContain('image/png')
    }
})

test.describe('service worker', () => {
    test.use({ serviceWorkers: 'allow' })

    test('shows the offline page when the network is gone', async ({
        page,
        context,
    }) => {
        await page.goto(gymPath('/'))
        await page.waitForFunction(
            () => navigator.serviceWorker?.controller !== null,
        )

        await context.setOffline(true)
        await page.reload()
        await expect(page.getByTestId('offline-page')).toBeVisible()

        await context.setOffline(false)
        await page.getByRole('button', { name: 'Retry' }).click()
        await expect(page.getByTestId('offline-page')).toBeHidden()
    })
})
