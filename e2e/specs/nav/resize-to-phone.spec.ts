import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 393, height: 852 }

async function expectPhonePage(page: Page) {
    await expect(page.getByTestId('bottom-nav-feed')).toBeVisible()
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
    await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none')
    await expect(page.getByTestId('nav-desktop-links')).not.toBeVisible()
}

for (const sidebarOpen of ['true', 'false']) {
    test(`switching between desktop and phone keeps the page, not a sidebar overlay (sidebar-open=${sidebarOpen})`, async ({
        page,
        context,
        baseURL,
    }) => {
        await context.addCookies([
            { name: 'sidebar-open', value: sidebarOpen, url: baseURL! },
        ])
        const state = sidebarOpen === 'true' ? 'expanded' : 'collapsed'
        await page.setViewportSize(DESKTOP)
        await gotoSettled(page, '/routes')
        await expect(page.getByTestId('nav-sidebar')).toHaveAttribute(
            'data-state',
            state,
        )

        for (let round = 0; round < 2; round++) {
            await page.setViewportSize(PHONE)
            await expectPhonePage(page)
            await page.setViewportSize(DESKTOP)
            await expect(page.getByTestId('nav-sidebar')).toHaveAttribute(
                'data-state',
                state,
            )
        }
    })
}

test('a DevTools device switch to a phone keeps the page, not a sidebar overlay', async ({
    page,
    context,
    baseURL,
    browserName,
}) => {
    test.skip(browserName !== 'chromium', 'device metrics need CDP')
    await context.addCookies([
        { name: 'sidebar-open', value: 'true', url: baseURL! },
    ])
    await page.setViewportSize(DESKTOP)
    await gotoSettled(page, '/routes')
    const cdp = await context.newCDPSession(page)

    for (let round = 0; round < 2; round++) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            ...PHONE,
            deviceScaleFactor: 3,
            mobile: true,
        })
        await expectPhonePage(page)
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            ...DESKTOP,
            deviceScaleFactor: 1,
            mobile: false,
        })
        await expect(page.getByTestId('nav-sidebar')).toHaveAttribute(
            'data-state',
            'expanded',
        )
    }
})
