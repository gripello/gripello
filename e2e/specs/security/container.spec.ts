import { test, expect } from '../../support/fixtures'
import { e2eGymId } from '../../support/api'
import { authHeader, gotoSettled, gymPath } from '../../support/nav'

test('nginx still binds the privileged http port and redirects to https', async ({
    request,
    baseURL,
}) => {
    const httpUrl = new URL('/', baseURL).toString().replace('https:', 'http:')
    const response = await request.get(httpUrl, { maxRedirects: 0 })

    expect(response.status()).toBe(301)
    expect(response.headers().location).toMatch(/^https:\/\//)
})

test('nginx proxies to the backend over loopback', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const serverVersion = response.headers()['x-gripello-api-version']
    expect(serverVersion).toBeTruthy()
    expect(await response.json()).toHaveProperty('version', serverVersion)
    if (serverVersion === 'dev') return

    const unsupported = await request.get('/api/health', {
        headers: { 'X-Gripello-Api-Version': '99.0.0' },
    })
    expect(unsupported.status()).toBe(400)
    expect(await unsupported.json()).toMatchObject({
        data: { version: { code: 'unsupported_version' } },
    })
})

test('nuxt server routes reach the backend over loopback', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, gymPath('/'))
    const response = await page.request.get(
        `/api/manage/analytics?gym=${await e2eGymId()}`,
        {
            headers: await authHeader(page),
        },
    )
    expect(response.status()).toBe(200)
})
