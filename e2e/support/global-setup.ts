import type { FullConfig } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { authCookieValue, login, type AuthResult } from './auth'
import {
    E2E_GYM_SLUG,
    ensureGym,
    ensureUser,
    seedRatings,
    seedRoutes,
} from './seed'

const AUTH_DIR = path.join(import.meta.dirname, '..', '.auth')
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

export default async function globalSetup(config: FullConfig) {
    ensureGym()
    const seededUsers = {
        admin: await ensureUser(null, 'admin', 'admin', PREFIX),
        routesetter: await ensureUser(
            null,
            'routesetter',
            'routesetter',
            PREFIX,
        ),
        user: await ensureUser(null, undefined, 'user', PREFIX),
        platform: await ensureUser(null, undefined, 'platform', PREFIX, true),
    }

    const sessions: Record<string, AuthResult> = {}
    for (const [role, seeded] of Object.entries(seededUsers)) {
        sessions[role] = await withRetry(() =>
            login(seeded.email, seeded.password),
        )
    }

    const { routes, created } = await seedRoutes(sessions.admin!.token, PREFIX)
    if (created) await seedRatings(PREFIX, routes)

    fs.mkdirSync(AUTH_DIR, { recursive: true })

    const baseURL =
        config.projects[0]?.use?.baseURL ||
        process.env.E2E_BASE_URL ||
        'https://localhost'

    for (const [role, session] of Object.entries(sessions)) {
        saveStorageState(
            baseURL,
            authCookieValue(session),
            path.join(AUTH_DIR, `${role}.json`),
        )
    }

    await warmUpPages(baseURL, authCookieValue(sessions.admin!))
}
