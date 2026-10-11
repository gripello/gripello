import {
    test as base,
    type Browser,
    type BrowserContext,
    type BrowserContextOptions,
    type Page,
} from '@playwright/test'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { RouteRecord } from '../../types/models'
import {
    Api,
    apiAs,
    createLocation,
    createRoute,
    deleteTestData,
    gymAdminApi,
    platformAdminApi,
    routeInput,
} from './api'
import { signInAs } from './auth'
import { E2E_GYM_SLUG, ensureUser, type SeededUser } from './seed'

const AUTH_DIR = path.join(import.meta.dirname, '..', '.auth')

type Role = 'admin' | 'routesetter' | 'user' | 'platform'

export const authFile = (role: Role) => path.join(AUTH_DIR, `${role}.json`)

interface Location {
    id: string
    name: string
}

interface WorkerFixtures {
    api: Api
    adminApi: Api
    adminToken: string
    workerLocation: Location
}

interface Fixtures {
    adminPage: Page
    setterPage: Page
    userPage: Page
    platformPage: Page
    testPrefix: string
    deviceOptions: BrowserContextOptions
    route: RouteRecord
    createRoute: (data?: Record<string, unknown>) => Promise<RouteRecord>
    apiAs: (user: Pick<SeededUser, 'email' | 'password'>) => Promise<Api>
    createUser: (role?: string, label?: string) => Promise<SeededUser>
    pageAs: (user: Pick<SeededUser, 'email' | 'password'>) => Promise<Page>
}

export async function withGymCookie(
    context: BrowserContext,
    baseURL: string | undefined,
) {
    if (!baseURL) return context
    await context.addCookies([
        { name: 'gym', value: E2E_GYM_SLUG, url: baseURL, sameSite: 'Lax' },
    ])
    return context
}

async function useRolePage(
    browser: Browser,
    deviceOptions: BrowserContextOptions,
    role: Role,
    use: (page: Page) => Promise<void>,
) {
    const context = await browser.newContext({
        ...deviceOptions,
        storageState: authFile(role),
    })
    await use(await context.newPage())
    await context.close()
}

export const test = base.extend<Fixtures, WorkerFixtures>({
    api: [
        async ({}, use) => {
            await use(await platformAdminApi())
        },
        { scope: 'worker' },
    ],
    adminApi: [
        async ({}, use) => {
            await use(await gymAdminApi())
        },
        { scope: 'worker' },
    ],
    adminToken: [
        async ({ adminApi }, use) => {
            await use(adminApi.token)
        },
        { scope: 'worker' },
    ],
    workerLocation: [
        async ({ adminApi }, use, workerInfo) => {
            const name = `e2e-w${workerInfo.workerIndex}-${randomUUID().slice(0, 8)} Hall`
            const location = await createLocation(adminApi, name)
            await use({ id: location.id, name })
            deleteTestData(name)
        },
        { scope: 'worker' },
    ],
    context: async ({ context, baseURL }, use) => {
        await use(await withGymCookie(context, baseURL))
    },
    deviceOptions: async (
        {
            baseURL,
            viewport,
            userAgent,
            deviceScaleFactor,
            isMobile,
            hasTouch,
            locale,
        },
        use,
    ) => {
        await use({
            baseURL,
            ignoreHTTPSErrors: true,
            viewport,
            userAgent,
            deviceScaleFactor,
            isMobile,
            hasTouch,
            locale,
        })
    },
    adminPage: async ({ browser, deviceOptions }, use) =>
        useRolePage(browser, deviceOptions, 'admin', use),
    setterPage: async ({ browser, deviceOptions }, use) =>
        useRolePage(browser, deviceOptions, 'routesetter', use),
    userPage: async ({ browser, deviceOptions }, use) =>
        useRolePage(browser, deviceOptions, 'user', use),
    platformPage: async ({ browser, deviceOptions }, use) =>
        useRolePage(browser, deviceOptions, 'platform', use),
    testPrefix: async ({}, use, testInfo) => {
        const prefix = `e2e-w${testInfo.workerIndex}-${Date.now()}`
        await use(prefix)
        deleteTestData(prefix)
    },
    apiAs: async ({}, use) => {
        await use(apiAs)
    },
    createRoute: async ({ adminApi, workerLocation, testPrefix }, use) => {
        let count = 0
        await use(async (data = {}) =>
            createRoute(
                adminApi,
                routeInput(
                    `${testPrefix}-route-${++count}`,
                    workerLocation.id,
                    data,
                ),
            ),
        )
    },
    route: async ({ createRoute }, use) => {
        await use(await createRoute())
    },
    createUser: async ({ testPrefix }, use) => {
        await use(async (role = 'user', label = role) =>
            ensureUser(
                null,
                role === 'user' ? undefined : role,
                'user',
                `${testPrefix}-${label}`,
            ),
        )
    },
    pageAs: async ({ browser, deviceOptions }, use) => {
        const contexts: BrowserContext[] = []
        await use(async (user) => {
            const context = await withGymCookie(
                await browser.newContext(deviceOptions),
                deviceOptions.baseURL,
            )
            contexts.push(context)
            const page = await context.newPage()
            await signInAs(page, user.email, user.password)
            return page
        })
        for (const context of contexts) await context.close()
    },
})

export { expect } from '@playwright/test'
