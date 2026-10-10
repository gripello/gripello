import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { apiFetch } from './auth'
import {
    gradeIndex,
    gradeLabels,
    type GradeSystem,
} from '../../shared/utils/grades'

export const LOCATIONS = ['Hall A', 'Hall B'] as const
export const E2E_GYM_SLUG = 'e2e'
export const TYPES = ['Route', 'Boulder'] as const

export interface SeededUser {
    id: string
    email: string
    password: string
    role: 'admin' | 'routesetter' | 'user' | 'platform'
}

export function gripelloAdmin(...args: string[]) {
    const command =
        process.env.E2E_GRIPELLO || 'go -C backend run ./cmd/gripello'
    return execFileSync(
        'sh',
        ['-c', `${command} admin "$@"`, 'gripello', ...args],
        {
            encoding: 'utf8',
            env: {
                DATABASE_URL:
                    'postgres://postgres:dev@localhost:5433/gripello?sslmode=disable',
                ...process.env,
            },
        },
    ).trim()
}

export function ensureGym() {
    return gripelloAdmin(
        'create-gym',
        '--slug',
        E2E_GYM_SLUG,
        '--name',
        'E2E Gym',
        '--features',
        JSON.stringify({ beta_videos: true }),
    )
}

export async function getRoleIds(): Promise<Record<string, string>> {
    return { admin: 'admin', routesetter: 'routesetter' }
}

export async function setMembership(
    _pb: unknown,
    userId: string,
    roleId: string | undefined,
) {
    return (
        gripelloAdmin(
            'add-membership',
            '--user',
            userId,
            '--gym',
            E2E_GYM_SLUG,
            '--role',
            roleId ?? '',
        ) || null
    )
}

export async function ensureUser(
    pb: unknown,
    roleId: string | undefined,
    role: SeededUser['role'],
    prefix: string,
    platformAdmin = false,
): Promise<SeededUser> {
    const email = `${prefix}-${role}@gripello.test`
    const password = 'E2ePassw0rd!'
    const id = gripelloAdmin(
        'create-user',
        '--email',
        email,
        '--password',
        password,
        '--username',
        `${prefix}${role}`,
        '--firstname',
        'E2E',
        '--name',
        role,
        '--verified',
        ...(platformAdmin ? ['--platform-admin'] : []),
    )
    await setMembership(pb, id, roleId)
    return { id, email, password, role }
}

export async function locationId(page: Page, name: string) {
    const response = await page.request.get(
        `/api/gyms/${E2E_GYM_SLUG}/locations`,
    )
    const { items } = (await response.json()) as {
        items: { id: string; name: string }[]
    }
    return items.find((location) => location.name === name)!.id
}

export function gradeOf(system: GradeSystem, grade: string) {
    return {
        grade,
        grade_system: system,
        grade_index: gradeIndex(system, grade),
    }
}

export const uiaa = (grade: string) => gradeOf('uiaa', grade)

function randomGrade(type: string) {
    const system = type === 'Boulder' ? 'font' : 'uiaa'
    const labels = gradeLabels(system)
    return gradeOf(system, labels[Math.floor(Math.random() * labels.length)]!)
}

export async function seedRoutes(token: string, prefix: string, count = 60) {
    const gymPath = `/gyms/${E2E_GYM_SLUG}`
    const { items: locations } = await apiFetch<{
        items: { id: string; name: string }[]
    }>(`${gymPath}/locations`, { token })
    const locationIds: Record<string, string> = {}
    for (const name of LOCATIONS) {
        locationIds[name] =
            locations.find((location) => location.name === name)?.id ??
            (
                await apiFetch<{ id: string }>(`${gymPath}/locations`, {
                    token,
                    method: 'POST',
                    body: { name },
                })
            ).id
    }
    const { items: existing } = await apiFetch<{
        items: { id: string; name: string }[]
    }>(
        `${gymPath}/routes?archived=all&limit=1000&q=${encodeURIComponent(`${prefix}-route-`)}`,
        { token },
    )
    const names = new Set(existing.map((route) => route.name))
    const routes = [...existing]
    for (let i = 0; i < count; i++) {
        const name = `${prefix}-route-${i}`
        if (names.has(name)) continue
        routes.push(
            await apiFetch<{ id: string; name: string }>(`${gymPath}/routes`, {
                token,
                method: 'POST',
                body: {
                    name,
                    ...randomGrade(TYPES[i % TYPES.length]!),
                    anchor_point: 1 + (i % 40),
                    location: locationIds[LOCATIONS[i % LOCATIONS.length]!],
                    type: TYPES[i % TYPES.length],
                    comment: `Seed comment ${i}`,
                    creator: [`Setter ${1 + (i % 5)}`],
                    screw_date: new Date(Date.now() - i * 86_400_000)
                        .toISOString()
                        .slice(0, 10),
                    color: '#F44336',
                    archived: i % 10 === 0,
                },
            }),
        )
    }
    return { routes, created: routes.length > existing.length }
}

export async function seedRatings(
    prefix: string,
    routes: { id: string }[],
    count = 40,
) {
    for (let i = 0; i < count; i++) {
        await apiFetch(`/routes/${routes[i % routes.length]!.id}/ratings`, {
            method: 'POST',
            body: {
                rating: 1 + (i % 5),
                ...uiaa(String(1 + (i % 10))),
                comment: `${prefix}-rating-${i}`,
            },
        })
    }
}
