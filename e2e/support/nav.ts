import type { Page } from '@playwright/test'
import { Api } from './api'
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

export async function reloadSettled(page: Page) {
    await page.reload()
    await page
        .locator('[data-testid="page-hydrated"]')
        .waitFor({ state: 'attached' })
}

export async function gotoSubscribed(page: Page, path: string, topic: string) {
    const subscribed = page.waitForResponse(
        (response) =>
            /\/api\/realtime\/[^/]+\/subscriptions/.test(response.url()) &&
            response.request().method() === 'PUT' &&
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
    // The auth cookie is only readable once the page shows an app document.
    if (page.url() === 'about:blank') await gotoSettled(page, '/')
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
    return { Authorization: `Bearer ${token}` }
}

export async function apiOf(page: Page) {
    const { Authorization } = await authHeader(page)
    return new Api(Authorization.replace(/^Bearer /, ''))
}

export async function searchRoutes(page: Page, text: string) {
    const filtered = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return (
            /\/api\/gyms\/[^/]+\/routes$/.test(url.pathname) &&
            url.searchParams.get('q') === text
        )
    })
    await page.getByTestId('filter-search').fill(text)
    await filtered
}
