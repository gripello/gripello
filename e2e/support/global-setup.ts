import type { FullConfig } from '@playwright/test'
import PocketBase from 'pocketbase'
import fs from 'node:fs'
import path from 'node:path'
import {
    authAsSuperuser,
    E2E_GYM_SLUG,
    ensureGym,
    ensureUser,
    getRoleIds,
    seedRatings,
    seedRoutes,
    sweepTestData,
} from './seed'
import { takeSnapshot } from './state-snapshot'

const AUTH_DIR = path.join(import.meta.dirname, '..', '.auth')
const PB_URL = process.env.E2E_PB_URL || 'https://localhost'
const PREFIX = 'e2e'

async function withRetry<T>(action: () => Promise<T>, attempts = 6) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await action()
        } catch (error) {
            if (attempt >= attempts) throw error
            await new Promise((resolve) => setTimeout(resolve, attempt * 500))
        }
    }
}

async function authCookieValue(email: string, password: string) {
    const pb = new PocketBase(PB_URL)
    await pb.collection('users').authWithPassword(email, password)
    const cookie = pb.authStore.exportToCookie({}, 'pb_auth')
    return cookie.slice('pb_auth='.length, cookie.indexOf(';'))
}

function saveStorageState(baseURL: string, cookieValue: string, file: string) {
    const url = new URL(baseURL)
    const state = {
        cookies: [
            {
                name: 'pb_auth',
                value: cookieValue,
                domain: url.hostname,
                path: '/',
                expires: -1,
                httpOnly: false,
                secure: url.protocol === 'https:',
                sameSite: 'Lax',
            },
            {
                name: 'gym',
                value: E2E_GYM_SLUG,
                domain: url.hostname,
                path: '/',
                expires: -1,
                httpOnly: false,
                secure: url.protocol === 'https:',
                sameSite: 'Lax',
            },
        ],
        origins: [],
    }
    fs.writeFileSync(file, JSON.stringify(state))
}

async function warmUpPages(baseURL: string, adminCookie: string) {
    for (const pagePath of ['/', '/auth/login', '/route', '/manage/routes']) {
        await withRetry(async () => {
            const response = await fetch(new URL(pagePath, baseURL), {
                headers: {
                    cookie: `pb_auth=${adminCookie}; gym=${E2E_GYM_SLUG}`,
                },
            })
            if (response.status >= 500) {
                throw new Error(`${pagePath} answered ${response.status}`)
            }
        })
    }
}

async function relaxRateLimits(pb: PocketBase) {
    await pb.settings.update({ rateLimits: { enabled: false } })
}

export default async function globalSetup(config: FullConfig) {
    const pb = new PocketBase(PB_URL)
    pb.autoCancellation(false)
    await withRetry(() => authAsSuperuser(pb))
    await ensureGym(pb)
    await takeSnapshot(pb)
    await relaxRateLimits(pb)
    await sweepTestData(pb, 'e2e-w')

    const roleIds = await getRoleIds(pb)
    const seededUsers = {
        admin: await ensureUser(pb, roleIds.admin, 'admin', PREFIX),
        routesetter: await ensureUser(
            pb,
            roleIds.routesetter,
            'routesetter',
            PREFIX,
        ),
        user: await ensureUser(pb, undefined, 'user', PREFIX),
        platform: await ensureUser(pb, undefined, 'platform', PREFIX),
    }
    await pb
        .collection('users')
        .update(seededUsers.admin.id, { platform_admin: false })
    await pb
        .collection('users')
        .update(seededUsers.platform.id, { platform_admin: true })

    const routes = await seedRoutes(pb, PREFIX)
    await seedRatings(pb, PREFIX, routes)

    fs.mkdirSync(AUTH_DIR, { recursive: true })

    const baseURL =
        config.projects[0]?.use?.baseURL ||
        process.env.E2E_BASE_URL ||
        'https://localhost'

    const cookies: Record<string, string> = {}
    for (const [role, seeded] of Object.entries(seededUsers)) {
        cookies[role] = await withRetry(() =>
            authCookieValue(seeded.email, seeded.password),
        )
        saveStorageState(
            baseURL,
            cookies[role]!,
            path.join(AUTH_DIR, `${role}.json`),
        )
    }

    await warmUpPages(baseURL, cookies.admin!)
}
