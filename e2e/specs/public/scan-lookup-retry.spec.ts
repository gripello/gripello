import { chromium, devices } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import os from 'node:os'
import path from 'node:path'
import { generateRouteQrY4m } from '../../support/qr'
import { gotoSettled } from '../../support/nav'

test('a failed route lookup is retried instead of marking the sign unknown', async ({
    baseURL,
    route,
}) => {
    test.setTimeout(120_000)
    const routeId = route.id

    const y4mPath = path.join(os.tmpdir(), `e2e-scan-retry-${routeId}.y4m`)
    generateRouteQrY4m(routeId, y4mPath)

    const browser = await chromium.launch({
        args: [
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${y4mPath}`,
            '--use-fake-ui-for-media-stream',
        ],
    })
    const context = await browser.newContext({
        ...devices['Pixel 7'],
        baseURL,
        ignoreHTTPSErrors: true,
        permissions: ['camera'],
    })
    const page = await context.newPage()
    const audioWarnings: string[] = []
    page.on('console', (message) => {
        if (/AudioContext/i.test(message.text()))
            audioWarnings.push(message.text())
    })
    let failedOnce = false
    await page.route(new RegExp(`/api/routes/${routeId}(\\?|$)`), (route) => {
        if (failedOnce) return route.continue()
        failedOnce = true
        return route.fulfill({ status: 500, json: { message: 'boom' } })
    })
    try {
        await gotoSettled(page, '/scan')
        await page.waitForURL(new RegExp(`/route\\?id=${routeId}`), {
            timeout: 30_000,
        })
        await expect(page.getByTestId('route-page-name')).toBeVisible()
        expect(failedOnce).toBe(true)
        expect(audioWarnings).toEqual([])
    } finally {
        await browser.close()
    }
})
