import {
    test as base,
    type Browser,
    type BrowserContext,
    type BrowserContextOptions,
    type Page,
} from '@playwright/test'
import type PocketBase from 'pocketbase'
import type { RecordModel } from 'pocketbase'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { signInAs } from './auth'
import {
    adminClient,
    authAsSuperuser,
    E2E_GYM_SLUG,
    e2eGymId,
    ensureUser,
    getRoleIds,
    sweepTestData,
    uiaa,
    type SeededUser,
} from './seed'

const AUTH_DIR = path.join(__dirname, '..', '.auth')

type Role = 'admin' | 'routesetter' | 'user' | 'platform'

export const authFile = (role: Role) => path.join(AUTH_DIR, `${role}.json`)

interface Location {
    id: string
    name: string
}

interface WorkerFixtures {
    root: PocketBase
    workerLocation: Location
}

interface Fixtures {
    adminPage: Page
    setterPage: Page
    userPage: Page
    platformPage: Page
    testPrefix: string
    deviceOptions: BrowserContextOptions
    route: RecordModel
    createRoute: (data?: Record<string, unknown>) => Promise<RecordModel>
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
    root: [
        async ({}, use) => {
            const pb = adminClient()
            await authAsSuperuser(pb)
            await use(pb)
        },
        { scope: 'worker' },
    ],
    workerLocation: [
        async ({ root }, use, workerInfo) => {
            const name = `e2e-w${workerInfo.workerIndex}-${randomUUID().slice(0, 8)} Hall`
            const location = await root
                .collection('locations')
                .create({ name, gym: await e2eGymId(root) })
            await use({ id: location.id, name })
            await sweepTestData(root, name)
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
    testPrefix: async ({ root, workerLocation }, use, testInfo) => {
        const prefix = `e2e-w${testInfo.workerIndex}-${Date.now()}`
        await use(prefix)
        await sweepTestData(root, prefix, workerLocation.id)
    },
    createRoute: async ({ root, workerLocation, testPrefix }, use) => {
        let count = 0
        await use(async (data = {}) =>
            root.collection('routes').create({
                name: `${testPrefix}-route-${++count}`,
                ...uiaa('5'),
                anchor_point: 1,
                location: workerLocation.id,
                type: 'Route',
                color: '#F44336',
                creator: ['E2E'],
                screw_date: new Date().toISOString().slice(0, 10),
                ...data,
            }),
        )
    },
    route: async ({ createRoute }, use) => {
        await use(await createRoute())
    },
    createUser: async ({ root, testPrefix }, use) => {
        const roleIds = await getRoleIds(root)
        await use(async (role = 'user', label = role) =>
            ensureUser(
                root,
                role === 'user' ? undefined : (roleIds[role] ?? role),
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
