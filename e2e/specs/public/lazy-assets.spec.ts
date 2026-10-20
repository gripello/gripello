import { test, expect } from '../../support/fixtures'
import { gymPath } from '../../support/nav'
import type { Page } from '@playwright/test'

const LAZY_ASSETS = /maplibre-gl-worker|pako_inflate|cap_wasm_bg/

async function requestedAssets(page: Page, path: string) {
    const urls: string[] = []
    page.on('request', (request) => urls.push(request.url()))
    const html = (await (await page.goto(path))?.text()) ?? ''
    await page
        .locator('[data-testid="page-hydrated"]')
        .waitFor({ state: 'attached' })
    await page.waitForLoadState('networkidle')
    return { urls, html }
}

test('the landing page loads no map worker or captcha assets', async ({
    page,
}) => {
    const { urls, html } = await requestedAssets(page, '/')
    expect(urls.filter((url) => LAZY_ASSETS.test(url))).toEqual([])
    expect(html).not.toMatch(LAZY_ASSETS)
})

test('the staff route list loads no map worker or captcha assets', async ({
    adminPage: page,
}) => {
    const { urls, html } = await requestedAssets(
        page,
        gymPath('/manage/routes'),
    )
    expect(urls.filter((url) => LAZY_ASSETS.test(url))).toEqual([])
    expect(html).not.toMatch(LAZY_ASSETS)
})
