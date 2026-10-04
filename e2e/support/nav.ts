import type { Page } from '@playwright/test'
import { E2E_GYM_SLUG } from './seed'

export function gymPath(path: string) {
    return path === '/' ? `/${E2E_GYM_SLUG}` : `/${E2E_GYM_SLUG}${path}`
}

export async function gotoSettled(
    page: Page,
    path: string,
    expectPath?: string | RegExp,
) {
    await page.goto(path)
    await page
        .locator('[data-testid="page-hydrated"]')
        .waitFor({ state: 'attached' })
    if (expectPath) await page.waitForURL(expectPath)
}

export async function gotoSubscribed(page: Page, path: string, topic: string) {
    const subscribed = page.waitForResponse(
        (response) =>
            response.url().includes('/api/realtime') &&
            response.request().method() === 'POST' &&
            !!response.request().postData()?.includes(topic),
    )
    await gotoSettled(page, path)
    await subscribed
}

export async function assertSettledUrl(
    page: Page,
    path: Parameters<Page['waitForURL']>[0],
) {
    await page.waitForURL(path)
    await page
        .locator('[data-testid="page-hydrated"]')
        .waitFor({ state: 'attached' })
}

export async function authHeader(
    page: Page,
): Promise<{ Authorization: string }> {
    const token = await page.evaluate(() => {
        const raw = document.cookie
            .split('; ')
            .find((c) => c.startsWith('pb_auth='))
        if (!raw) return ''
        try {
            return JSON.parse(
                decodeURIComponent(raw.split('=').slice(1).join('=')),
            ).token
        } catch {
            return ''
        }
    })
    return { Authorization: token }
}

export async function searchRoutes(page: Page, text: string) {
    const filtered = page.waitForResponse(
        (response) =>
            response.url().includes('/api/collections/averageRating/records') &&
            decodeURIComponent(response.url()).includes(`name ~ "${text}"`),
    )
    await page.getByTestId('filter-search').fill(text)
    await filtered
}
