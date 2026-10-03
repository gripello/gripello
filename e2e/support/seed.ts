import PocketBase from 'pocketbase'
import type { Page } from '@playwright/test'
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

export async function authAsSuperuser(pb: PocketBase) {
    const email = process.env.PB_SUPERUSER_EMAIL || 'e2e-super@gripello.test'
    const password = process.env.PB_SUPERUSER_PASSWORD || 'e2e-superuser-pw-123'
    await pb.collection('_superusers').authWithPassword(email, password)
}

export async function ensureGym(pb: PocketBase) {
    const filter = pb.filter('slug = {:slug}', { slug: E2E_GYM_SLUG })
    return pb
        .collection('gyms')
        .getFirstListItem(filter, { requestKey: null })
        .catch(() =>
            pb.collection('gyms').create({
                slug: E2E_GYM_SLUG,
                name: 'E2E Gym',
                active: true,
            }),
        )
}

let cachedE2eGymId: Promise<string> | null = null

export function e2eGymId(pb: PocketBase) {
    cachedE2eGymId ??= pb
        .collection('gyms')
        .getFirstListItem(pb.filter('slug = {:slug}', { slug: E2E_GYM_SLUG }), {
            requestKey: null,
        })
        .then((gym) => gym.id)
        .catch((error) => {
            cachedE2eGymId = null
            throw error
        })
    return cachedE2eGymId
}

export function e2eGym() {
    return e2eGymId(adminClient())
}

export async function getRoleIds(pb: PocketBase) {
    const roles = await pb.collection('roles').getFullList({
        filter: pb.filter('gym = {:gym}', { gym: await e2eGymId(pb) }),
        requestKey: null,
    })
    const byName: Record<string, string> = {}
    for (const r of roles) byName[r.name] = r.id
    return byName
}

export async function e2eRole(pb: PocketBase, name: string) {
    return pb.collection('roles').getFirstListItem(
        pb.filter('gym = {:gym} && name = {:name}', {
            gym: await e2eGymId(pb),
            name,
        }),
        { requestKey: null },
    )
}

export async function setMembership(
    pb: PocketBase,
    userId: string,
    roleId: string | undefined,
) {
    const gym = await e2eGymId(pb)
    const existing = await pb
        .collection('memberships')
        .getFirstListItem(
            pb.filter('user = {:user} && gym = {:gym}', { user: userId, gym }),
            { requestKey: null },
        )
        .catch(() => null)
    if (!roleId) {
        if (existing) await pb.collection('memberships').delete(existing.id)
        return null
    }
    if (existing) {
        return pb
            .collection('memberships')
            .update(existing.id, { role: roleId })
    }
    return pb
        .collection('memberships')
        .create({ user: userId, gym, role: roleId })
}

export async function ensureUser(
    pb: PocketBase,
    roleId: string | undefined,
    role: SeededUser['role'],
    prefix: string,
): Promise<SeededUser> {
    const email = `${prefix}-${role}@gripello.test`
    const password = 'E2ePassw0rd!'

    const existing = await pb
        .collection('users')
        .getFirstListItem(pb.filter('email = {:email}', { email }), {
            requestKey: null,
        })
        .catch(() => null)

    let record
    if (existing) {
        record = await pb.collection('users').update(existing.id, {
            password,
            passwordConfirm: password,
            verified: true,
        })
    } else {
        record = await pb.collection('users').create({
            email,
            emailVisibility: true,
            password,
            passwordConfirm: password,
            verified: true,
            username: `${prefix}${role}`,
            firstname: 'E2E',
            name: role,
        })
    }
    await setMembership(pb, record.id, roleId)

    return { id: record.id, email, password, role }
}

export async function ensureLocations(pb: PocketBase) {
    const idByName: Record<string, string> = {}
    for (const name of LOCATIONS) {
        let record
        try {
            record = await pb
                .collection('locations')
                .getFirstListItem(pb.filter('name = {:name}', { name }), {
                    requestKey: null,
                })
        } catch {
            record = await pb
                .collection('locations')
                .create({ name, gym: await e2eGymId(pb) })
        }
        idByName[name] = record.id
    }
    return idByName
}

export async function locationId(page: Page, name: string) {
    const response = await page.request.get(
        '/api/collections/locations/records',
        { params: { filter: `name = "${name}"` } },
    )
    const { items } = await response.json()
    return items[0].id as string
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

export async function seedRoutes(pb: PocketBase, prefix: string, count = 60) {
    const locationIds = await ensureLocations(pb)
    const locationFor = (index: number) =>
        locationIds[LOCATIONS[index % LOCATIONS.length]]

    const existing = await pb.collection('routes').getFullList({
        filter: `name ~ "${prefix}-route-"`,
        requestKey: null,
    })
    for (const route of existing) {
        const index = Number(route.name.split('-').pop())
        const archived = index % 10 === 0
        if (
            route.location !== locationFor(index) ||
            route.archived !== archived
        ) {
            await pb
                .collection('routes')
                .update(route.id, { location: locationFor(index), archived })
        }
    }
    if (existing.length >= count) return existing

    const created = [...existing]
    for (let i = existing.length; i < count; i++) {
        const route = await pb.collection('routes').create({
            name: `${prefix}-route-${i}`,
            ...randomGrade(TYPES[i % TYPES.length]!),
            anchor_point: 1 + (i % 40),
            location: locationFor(i),
            type: TYPES[i % TYPES.length],
            comment: `Seed comment ${i}`,
            creator: [`Setter ${1 + (i % 5)}`],
            screw_date: new Date(Date.now() - i * 86_400_000)
                .toISOString()
                .slice(0, 10),
            color: '#F44336',
            archived: i % 10 === 0,
        })
        created.push(route)
    }
    return created
}

export async function seedRatings(
    pb: PocketBase,
    prefix: string,
    routes: { id: string }[],
    count = 40,
) {
    const existing = await pb.collection('ratings').getFullList({
        filter: `comment ~ "${prefix}-rating-"`,
        requestKey: null,
    })
    if (existing.length >= count) return existing

    const created = [...existing]
    for (let i = existing.length; i < count; i++) {
        const route = routes[i % routes.length]
        const rating = await pb.collection('ratings').create({
            route_id: route.id,
            rating: 1 + (i % 5),
            ...uiaa(String(1 + (i % 10))),
            comment: `${prefix}-rating-${i}`,
        })
        created.push(rating)
    }
    return created
}

export function adminClient() {
    const pb = new PocketBase(process.env.E2E_PB_URL || 'https://localhost')
    pb.autoCancellation(false)
    return pb
}

export async function createRole(
    pb: PocketBase,
    name: string,
    permissionNames: string[] = [],
) {
    const permissions = permissionNames.length
        ? await pb.collection('permissions').getFullList({
              filter: permissionNames
                  .map((permission) =>
                      pb.filter('name = {:permission}', { permission }),
                  )
                  .join(' || '),
          })
        : []
    return pb.collection('roles').create({
        gym: await e2eGymId(pb),
        name,
        permissions: permissions.map((permission) => permission.id),
    })
}

async function deleteMatching(
    pb: PocketBase,
    collection: string,
    filter: string,
) {
    const records = await pb
        .collection(collection)
        .getFullList({ filter, fields: 'id' })
    for (const record of records) {
        await pb
            .collection(collection)
            .delete(record.id)
            .catch(() => {})
    }
}

export async function sweepTestData(
    pb: PocketBase,
    prefix: string,
    locationId?: string,
) {
    const name = pb.filter('{:prefix}', { prefix })
    const username = pb.filter('{:username}', {
        username: prefix.replace(/-/g, ''),
    })
    const location = pb.filter('{:locationId}', {
        locationId: locationId ?? '',
    })
    const inLocation = locationId ? ` || location = ${location}` : ''
    const routeInLocation = locationId ? ` || route.location = ${location}` : ''
    const owned = `name ~ ${name} || location.name ~ ${name}${inLocation}`

    await deleteMatching(pb, 'notifications', `params ~ ${name}`)
    await deleteMatching(pb, 'reports', `explanation ~ ${name}`)
    await deleteMatching(
        pb,
        'tasks',
        `title ~ ${name} || description ~ ${name} || route.name ~ ${name}${routeInLocation}${inLocation}`,
    )
    await deleteMatching(
        pb,
        'ticks',
        `route.name ~ ${name} || route.location.name ~ ${name} || user.email ~ ${name}${routeInLocation}`,
    )
    await deleteMatching(pb, 'ratings', `comment ~ ${name}`)
    await deleteMatching(pb, 'competitions', owned)
    await deleteMatching(pb, 'routes', owned)
    await deleteMatching(pb, 'walls', owned)
    await deleteMatching(pb, 'locations', `name ~ ${name}`)
    await deleteMatching(
        pb,
        'memberships',
        `user.email ~ ${name} || user.username ~ ${username} || role.name ~ ${name}`,
    )
    await deleteMatching(
        pb,
        'users',
        `email ~ ${name} || username ~ ${username}`,
    )
    await deleteMatching(pb, 'roles', `name ~ ${name}`)
}
