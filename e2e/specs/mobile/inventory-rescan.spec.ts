import { test, expect, chromium, devices } from '@playwright/test'
import PocketBase from 'pocketbase'
import path from 'node:path'
import os from 'node:os'
import { generateRouteQrY4m } from '../../support/qr'
import { gotoSettled } from '../../support/nav'
import { PB_URL } from '../../support/map'
import { authAsSuperuser, e2eGymId, uiaa } from '../../support/seed'

const AUTH_FILE = path.join(
    import.meta.dirname,
    '..',
    '..',
    '.auth',
    'admin.json',
)

test('a code shown again after undo is scanned again', async ({
    baseURL,
}, testInfo) => {
    test.setTimeout(120_000)
    const prefix = `e2e-w${testInfo.workerIndex}-${Date.now()}`
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const location = await root
        .collection('locations')
        .create({ name: `${prefix}-rescan`, gym: await e2eGymId(root) })
    const route = await root.collection('routes').create({
        name: `${prefix}-rescan`,
        ...uiaa('5'),
        location: location.id,
        type: 'Route',
        creator: ['E2E'],
    })

    const y4mPath = path.join(os.tmpdir(), `${prefix}-rescan.y4m`)
    generateRouteQrY4m(route.id, y4mPath, { codeFrames: 25, blankFrames: 50 })

    const browser = await chromium.launch({
        args: [
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${y4mPath}`,
            '--use-fake-ui-for-media-stream',
        ],
    })
    try {
        const context = await browser.newContext({
            ...devices['Pixel 7'],
            baseURL,
            ignoreHTTPSErrors: true,
            storageState: AUTH_FILE,
            permissions: ['camera'],
        })
        const page = await context.newPage()
        await page.addInitScript(() => {
            localStorage.setItem('inventory-instructions-seen', '1')
            localStorage.removeItem('inventory-scanned-route-ids')
        })
        await gotoSettled(page, '/manage/inventory')
        await page.getByTestId(`inventory-location-${location.name}`).click()
        await expect(page.getByTestId('inventory-start')).toBeEnabled({
            timeout: 30_000,
        })
        await page.getByTestId('inventory-start').click()

        const foundCount = page.getByTestId('inventory-found-count')
        await expect(foundCount).toHaveText('1', { timeout: 30_000 })

        await page.getByTestId('inventory-tab-found').click()
        await page.getByTestId(`inventory-undo-${route.id}`).click()
        await expect(foundCount).toHaveText('0')
        await expect(foundCount).toHaveText('1', { timeout: 30_000 })
    } finally {
        await browser.close()
        await root.collection('routes').delete(route.id)
        await root.collection('locations').delete(location.id)
    }
})
