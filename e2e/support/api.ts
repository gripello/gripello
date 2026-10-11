import { expect } from '@playwright/test'
import type {
    AuditLogRecord,
    BetaVideoRecord,
    BlockRecord,
    CompetitionCategoryRecord,
    CompetitionEntryRecord,
    CompetitionRecord,
    CompetitionRouteRecord,
    CompetitionScoreRecord,
    FollowRecord,
    GymRecord,
    InviteRecord,
    LocationRecord,
    ModerationItemRecord,
    NotificationRecord,
    PushSubscriptionRecord,
    RatingRecord,
    ReportRecord,
    RoleRecord,
    RouteRecord,
    SeasonRecord,
    SettingsRecord,
    TaskRecord,
    TickRecord,
    UserRecord,
    WallRecord,
} from '../../types/models'
import { API_URL, apiFetch, login, type ApiRequest, type Query } from './auth'
import {
    E2E_GYM_SLUG,
    gripelloAdmin,
    LOCATIONS,
    uiaa,
    type SeededUser,
} from './seed'

export { ApiError, type Query } from './auth'

type Body = Record<string, unknown>
type Page<T> = { items: T[]; page: number; limit: number; total?: number }
type Items<T> = { items: T[] }
export type UploadFile = { name: string; mimeType: string; buffer: Buffer }
export type Role = RoleRecord & { permissions: string[] }
export type Member = {
    id: string
    gym: string
    user: { id: string; email?: string; username: string }
    role: Role
}
export type PlatformUser = UserRecord & {
    memberships: { id: string; gym: string; role: string }[]
}
export type Decision = { id: string; state: string; hidden_by?: string }

export class Api {
    constructor(readonly token = '') {}

    request<T>(path: string, init: Omit<ApiRequest, 'token'> = {}) {
        return apiFetch<T>(path, { ...init, token: this.token || undefined })
    }

    get<T>(path: string, query?: Query) {
        return this.request<T>(path, { query })
    }

    post<T>(path: string, body?: unknown, headers?: Record<string, string>) {
        return this.request<T>(path, { method: 'POST', body, headers })
    }

    patch<T>(path: string, body: unknown) {
        return this.request<T>(path, { method: 'PATCH', body })
    }

    put<T>(path: string, body: unknown) {
        return this.request<T>(path, { method: 'PUT', body })
    }

    delete<T = null>(path: string, query?: Query) {
        return this.request<T>(path, { method: 'DELETE', query })
    }

    upload<T>(
        path: string,
        fields: Body,
        files: Record<string, UploadFile>,
        { method = 'POST', jsonPayload = true } = {},
    ) {
        const form = new FormData()
        if (jsonPayload) form.append('@jsonPayload', JSON.stringify(fields))
        else
            for (const [key, value] of Object.entries(fields))
                if (value !== undefined) form.append(key, String(value ?? ''))
        for (const [key, file] of Object.entries(files))
            form.append(
                key,
                new Blob([new Uint8Array(file.buffer)], {
                    type: file.mimeType,
                }),
                file.name,
            )
        return this.request<T>(path, { method, body: form })
    }
}

export const guestApi = () => new Api()

export async function apiAs(user: Pick<SeededUser, 'email' | 'password'>) {
    return new Api((await login(user.email, user.password)).token)
}

export const gymAdminApi = () =>
    apiAs({ email: 'e2e-admin@gripello.test', password: 'E2ePassw0rd!' })

export const platformAdminApi = () =>
    apiAs({ email: 'e2e-platform@gripello.test', password: 'E2ePassw0rd!' })

export function fileUrl(table: string, id: string, name: string) {
    return `${API_URL}/api/files/${table}/${id}/${encodeURIComponent(name)}`
}

let e2eGymRecord: Promise<GymRecord> | null = null

export function e2eGym() {
    e2eGymRecord ??= getGym(guestApi(), E2E_GYM_SLUG).catch((error) => {
        e2eGymRecord = null
        throw error
    })
    return e2eGymRecord
}

export async function e2eGymId() {
    return (await e2eGym()).id
}

export const getGym = (api: Api, slugOrId: string) =>
    api.get<GymRecord>(`/gyms/${slugOrId}`)
export const createGym = (
    api: Api,
    input: { slug: string; name: string } & Body,
) => api.post<GymRecord>('/gyms', input)
export const updateGym = async (api: Api, slugOrId: string, patch: Body) =>
    api.patch<GymRecord>(`/gyms/${(await getGym(api, slugOrId)).id}`, patch)
export const deleteGym = (api: Api, gym: string) => api.delete(`/gyms/${gym}`)
export const deleteMe = (api: Api, password: string) =>
    api.request('/me', { method: 'DELETE', body: { password } })
export const setGymFeatures = (
    api: Api,
    gymId: string,
    features: Record<string, boolean>,
) => api.put<GymRecord>(`/platform/gyms/${gymId}/features`, features)
export const getSettings = (api: Api) => api.get<SettingsRecord>('/settings')
export const updateSettings = (api: Api, patch: Partial<SettingsRecord>) =>
    api.patch<SettingsRecord>('/settings', patch)

export async function listLocations(api: Api, gym = E2E_GYM_SLUG) {
    return (await api.get<Items<LocationRecord>>(`/gyms/${gym}/locations`))
        .items
}
export const createLocation = (api: Api, name: string, gym = E2E_GYM_SLUG) =>
    api.post<LocationRecord>(`/gyms/${gym}/locations`, { name })
export const updateLocation = (api: Api, id: string, patch: Body) =>
    api.patch<LocationRecord>(`/locations/${id}`, patch)
export const deleteLocation = (api: Api, id: string) =>
    api.delete(`/locations/${id}`)
export const saveFloorPlan = (
    api: Api,
    locationId: string,
    plan: { map: unknown; walls: Body[]; removed?: string[] },
) =>
    api.put<{ location: LocationRecord; walls: WallRecord[] }>(
        `/locations/${locationId}/floor-plan`,
        { removed: [], ...plan },
    )

export async function ensureLocations(api: Api) {
    const existing = await listLocations(api)
    const idByName: Record<string, string> = {}
    for (const name of LOCATIONS)
        idByName[name] =
            existing.find((location) => location.name === name)?.id ??
            (await createLocation(api, name)).id
    return idByName
}

export async function listWalls(
    api: Api,
    location?: string,
    gym = E2E_GYM_SLUG,
) {
    return (
        await api.get<Items<WallRecord>>(`/gyms/${gym}/walls`, { location })
    ).items
}
export const createWall = (api: Api, input: Body, gym = E2E_GYM_SLUG) =>
    api.post<WallRecord>(`/gyms/${gym}/walls`, input)
export const updateWall = (api: Api, id: string, patch: Body) =>
    api.patch<WallRecord>(`/walls/${id}`, patch)
export const deleteWall = (api: Api, id: string) => api.delete(`/walls/${id}`)

export function routeInput(name: string, location: string, data: Body = {}) {
    return {
        name,
        ...uiaa('5'),
        anchor_point: 1,
        location,
        type: 'Route',
        color: '#F44336',
        creator: ['E2E'],
        screw_date: new Date().toISOString().slice(0, 10),
        ...data,
    }
}
export const createRoute = (api: Api, input: Body, gym = E2E_GYM_SLUG) =>
    api.post<RouteRecord>(`/gyms/${gym}/routes`, input)
export const getRoute = (api: Api, id: string) =>
    api.get<RouteRecord>(`/routes/${id}`)
export const updateRoute = (api: Api, id: string, patch: Body) =>
    api.patch<RouteRecord>(`/routes/${id}`, patch)
export const archiveRoute = (api: Api, id: string, archived = true) =>
    api.post<RouteRecord>(`/routes/${id}/archive`, { archived })
export const deleteRoute = (api: Api, id: string) =>
    api.delete(`/routes/${id}`, { force: true })
export async function listRoutes(
    api: Api,
    query: Query = {},
    gym = E2E_GYM_SLUG,
) {
    return (await api.get<Page<RouteRecord>>(`/gyms/${gym}/routes`, query))
        .items
}

export const createRating = (api: Api, routeId: string, input: Body = {}) =>
    api.post<RatingRecord>(`/routes/${routeId}/ratings`, {
        rating: 5,
        ...uiaa('5'),
        ...input,
    })
export const updateRating = (api: Api, id: string, patch: Body) =>
    api.patch<RatingRecord>(`/ratings/${id}`, patch)
export const deleteRating = (api: Api, id: string) =>
    api.delete(`/ratings/${id}`)
export async function listRouteRatings(api: Api, routeId: string) {
    return (
        await api.get<Page<RatingRecord>>(`/routes/${routeId}/ratings`, {
            limit: 500,
        })
    ).items
}

export const createBetaLink = (api: Api, routeId: string, url: string) =>
    api.post<BetaVideoRecord | { pending: true }>(`/routes/${routeId}/betas`, {
        url,
    })
export const uploadBeta = (api: Api, routeId: string, file: UploadFile) =>
    api.upload<BetaVideoRecord | { pending: true }>(
        `/routes/${routeId}/betas`,
        {},
        { file },
    )
export const deleteBeta = (api: Api, id: string) => api.delete(`/betas/${id}`)
export async function listBetas(api: Api, routeId: string) {
    return (await api.get<Items<BetaVideoRecord>>(`/routes/${routeId}/betas`))
        .items
}

export const createTask = (api: Api, input: Body, gym = E2E_GYM_SLUG) =>
    api.post<TaskRecord>(`/gyms/${gym}/tasks`, input)
export const createDefect = (
    api: Api,
    routeId: string,
    description: string,
    category = 'loose_bolt',
    gym = E2E_GYM_SLUG,
) =>
    createTask(
        api,
        { kind: 'defect', route: routeId, category, description },
        gym,
    )
export const getTask = (api: Api, id: string) =>
    api.get<TaskRecord>(`/tasks/${id}`)
export const updateTask = (api: Api, id: string, patch: Body) =>
    api.patch<TaskRecord>(`/tasks/${id}`, patch)
export const setTaskStatus = (
    api: Api,
    id: string,
    status: string,
    note?: string,
) =>
    api.post<TaskRecord>(`/tasks/${id}/status`, {
        status,
        ...(note === undefined ? {} : { resolution_note: note }),
    })
export const assignTask = (api: Api, id: string, assignee: string | null) =>
    api.post<TaskRecord>(`/tasks/${id}/assign`, { assignee })
export const deleteTask = (api: Api, id: string) => api.delete(`/tasks/${id}`)
export async function listTasks(
    api: Api,
    query: Query = {},
    gym = E2E_GYM_SLUG,
) {
    return (await api.get<Page<TaskRecord>>(`/gyms/${gym}/tasks`, query)).items
}

export function fileReport(
    api: Api,
    input: {
        contentType: 'rating' | 'route' | 'beta_video' | 'profile'
        contentId: string
        explanation: string
        reason?: string
        notifierName?: string
        notifierEmail?: string
    },
) {
    return api.post<{ id: string }>('/reports', {
        content_type: input.contentType,
        content_id: input.contentId,
        reason: input.reason ?? 'spam_fraud',
        explanation: input.explanation,
        notifier_name: input.notifierName ?? 'E2E Reporter',
        notifier_email: input.notifierEmail ?? 'e2e-reporter@example.com',
        good_faith: true,
    })
}
export async function listReports(api: Api, query: Query = {}, gym?: string) {
    return (
        await api.get<Page<ReportRecord>>(
            gym ? `/gyms/${gym}/reports` : '/platform/reports',
            { limit: 200, ...query },
        )
    ).items
}
export async function findReport(api: Api, id: string, gym?: string) {
    return (await listReports(api, {}, gym)).find((report) => report.id === id)
}

export async function listModerationCases(api: Api, query: Query = {}) {
    return (
        await api.get<Page<ModerationItemRecord>>('/moderation/cases', query)
    ).items
}
export const openModerationCase = (
    api: Api,
    contentType: string,
    contentId: string,
) =>
    api.post<Decision>('/moderation/cases', {
        content_type: contentType,
        content_id: contentId,
    })
export const getModerationCase = (api: Api, id: string) =>
    api.get<ModerationItemRecord>(`/moderation/${id}`)
export const decideModerationCase = (
    api: Api,
    id: string,
    action: 'approve' | 'reject' | 'hide' | 'restore',
    reason = '',
) => api.post<Decision>(`/moderation/${id}`, { action, reason })
export const hideAuthorContent = (api: Api, userId: string, reason: string) =>
    api.post<{ hidden: number }>(`/moderation/authors/${userId}/hide`, {
        reason,
    })

export async function listNotifications(api: Api, query: Query = {}) {
    return (
        await api.get<Page<NotificationRecord>>('/me/notifications', {
            limit: 200,
            ...query,
        })
    ).items
}
export async function notificationsOfType(api: Api, type: string) {
    return (await listNotifications(api)).filter((item) => item.type === type)
}
export async function waitForNotificationOfType(api: Api, type: string) {
    let found: NotificationRecord | undefined
    await expect
        .poll(
            async () => !!(found = (await notificationsOfType(api, type))[0]),
            {
                message: `${type} notification`,
            },
        )
        .toBe(true)
    return found!
}
export const markNotificationsRead = (api: Api, ids: string[] | 'all') =>
    api.post('/me/notifications/read', ids === 'all' ? { all: true } : { ids })
export const deleteNotification = (api: Api, id: string) =>
    api.delete(`/me/notifications/${id}`)
export function createNotificationFor(
    user: string,
    type: string,
    params: Record<string, unknown> = {},
    url = '',
) {
    return gripelloAdmin(
        'create-notification',
        '--user',
        user,
        '--type',
        type,
        '--params',
        JSON.stringify(params),
        '--url',
        url,
    )
}

export const createPushSubscription = (
    api: Api,
    input: { endpoint: string; p256dh: string; auth: string; device?: string },
) => api.post<PushSubscriptionRecord>('/me/push-subscriptions', input)
export async function listPushSubscriptions(api: Api) {
    return (
        await api.get<Items<PushSubscriptionRecord>>('/me/push-subscriptions')
    ).items
}
export const deletePushSubscription = (api: Api, id: string) =>
    api.delete(`/me/push-subscriptions/${id}`)

export type AuditQuery = {
    action?: string
    collection?: string
    actor?: string
    q?: string
    from?: string
    to?: string
}
export async function listAudit(
    api: Api,
    scope: 'platform' | 'own' | { gym: string },
    query: AuditQuery = {},
) {
    const path =
        scope === 'platform'
            ? '/platform/audit'
            : scope === 'own'
              ? '/me/audit'
              : `/gyms/${scope.gym}/audit`
    return (await api.get<Page<AuditLogRecord>>(path, { limit: 200, ...query }))
        .items
}

export const createSeason = (
    api: Api,
    input: { name: string; starts_at: string; ends_at: string },
    gym = E2E_GYM_SLUG,
) => api.post<SeasonRecord>(`/gyms/${gym}/seasons`, input)
export const deleteSeason = (api: Api, id: string) =>
    api.delete(`/seasons/${id}`)

export const createTick = (
    api: Api,
    input: {
        route: string
        type: string
        attempts?: number
        date?: string
        note?: string
    },
) =>
    api.post<TickRecord>('/me/ticks', {
        attempts: 1,
        date: new Date().toISOString(),
        ...input,
    })
export const updateTick = (api: Api, id: string, patch: Body) =>
    api.patch<TickRecord>(`/ticks/${id}`, patch)
export const deleteTick = (api: Api, id: string) => api.delete(`/ticks/${id}`)
export async function listOwnTicks(api: Api, query: Query = {}) {
    return (
        await api.get<Page<TickRecord>>('/me/ticks', { limit: 1000, ...query })
    ).items
}

export const createCompetition = (api: Api, input: Body, gym = E2E_GYM_SLUG) =>
    api.post<CompetitionRecord>(`/gyms/${gym}/competitions`, input)
export const getCompetition = (api: Api, id: string) =>
    api.get<CompetitionRecord>(`/competitions/${id}`)
export const updateCompetition = (api: Api, id: string, patch: Body) =>
    api.patch<CompetitionRecord>(`/competitions/${id}`, patch)
export const publishCompetition = (api: Api, id: string) =>
    api.post<CompetitionRecord>(`/competitions/${id}/publish`)
export const deleteCompetition = (api: Api, id: string) =>
    api.delete(`/competitions/${id}`)
export const createCompetitionCategory = (
    api: Api,
    competition: string,
    input: Body,
) =>
    api.post<CompetitionCategoryRecord>(
        `/competitions/${competition}/categories`,
        input,
    )
export async function listCompetitionCategories(api: Api, competition: string) {
    return (
        await api.get<Items<CompetitionCategoryRecord>>(
            `/competitions/${competition}/categories`,
        )
    ).items
}
export const createCompetitionRoute = (
    api: Api,
    competition: string,
    input: Body,
) =>
    api.post<CompetitionRouteRecord>(
        `/competitions/${competition}/routes`,
        input,
    )
export const createCompetitionEntry = (
    api: Api,
    competition: string,
    input: Body,
) =>
    api.post<CompetitionEntryRecord>(
        `/competitions/${competition}/entries`,
        input,
    )
export const updateCompetitionEntry = (api: Api, id: string, patch: Body) =>
    api.patch<CompetitionEntryRecord>(`/competition-entries/${id}`, patch)
export async function putCompetitionScores(
    api: Api,
    competition: string,
    scores: Body[],
) {
    return (
        await api.put<Items<CompetitionScoreRecord>>(
            `/competitions/${competition}/scores`,
            { scores },
        )
    ).items
}
export async function listCompetitionScores(
    api: Api,
    competition: string,
    entry?: string,
) {
    return (
        await api.get<Items<CompetitionScoreRecord>>(
            `/competitions/${competition}/scores`,
            { entry },
        )
    ).items
}

export const createFollow = (api: Api, followee: string) =>
    api.post<FollowRecord>('/follows', { followee })
export const acceptFollow = (api: Api, id: string) =>
    api.post<FollowRecord>(`/follows/${id}/accept`)
export const deleteFollow = (api: Api, id: string) =>
    api.delete(`/follows/${id}`)
export const listFollows = (
    api: Api,
    query: { direction?: 'followers' | 'following'; status?: string } = {},
) => api.get<FollowRecord[]>('/me/follows', query)
export const createBlock = (api: Api, blocked: string) =>
    api.post<BlockRecord>('/blocks', { blocked })
export const deleteBlock = (api: Api, id: string) => api.delete(`/blocks/${id}`)

export const getMe = (api: Api) => api.get<UserRecord>('/me')
export const updateMe = (api: Api, patch: Body) =>
    api.patch<UserRecord>('/me', patch)
export const uploadMyImage = (
    api: Api,
    field: 'avatar' | 'banner',
    file: UploadFile,
) => api.upload<UserRecord>('/me', {}, { [field]: file }, { method: 'PATCH' })
export const getPlatformUser = (api: Api, id: string) =>
    api.get<PlatformUser>(`/platform/users/${id}`)
export const updatePlatformUser = (api: Api, id: string, patch: Body) =>
    api.patch<PlatformUser>(`/platform/users/${id}`, patch)
export const deletePlatformUser = (api: Api, id: string) =>
    api.delete(`/platform/users/${id}`)
export const suspendUser = (
    api: Api,
    id: string,
    suspension: { reason: string; until?: string; permanent?: true },
) => api.post(`/platform/users/${id}/suspension`, suspension)
export const liftSuspension = (api: Api, id: string) =>
    api.delete(`/platform/users/${id}/suspension`)
export const grantPlatformAdmin = (api: Api, user: string) =>
    api.post<PlatformUser>('/platform/admins', { user })
export const revokePlatformAdmin = (api: Api, user: string) =>
    api.delete(`/platform/admins/${user}`)

export function setUserFlags(
    user: string,
    flags: {
        verified?: boolean
        platformAdmin?: boolean
        suspendedUntil?: string
        password?: string
    },
) {
    const args = ['set-user', '--user', user]
    if (flags.verified !== undefined) args.push(`--verified=${flags.verified}`)
    if (flags.platformAdmin !== undefined)
        args.push(`--platform-admin=${flags.platformAdmin}`)
    if (flags.suspendedUntil !== undefined)
        args.push('--suspended-until', flags.suspendedUntil)
    if (flags.password !== undefined) args.push('--password', flags.password)
    return gripelloAdmin(...args)
}
export const deleteUser = (user: string) =>
    gripelloAdmin('delete-user', '--user', user)
export const deleteTestData = (prefix: string) =>
    gripelloAdmin('truncate-prefix', '--prefix', prefix)

const memberGym = async (gymId?: string) => gymId ?? (await e2eGymId())

export async function listRoles(api: Api, gymId?: string) {
    return api.get<(Role & { members: number })[]>(
        `/gyms/${await memberGym(gymId)}/roles`,
    )
}
export async function findRole(api: Api, name: string, gymId?: string) {
    const role = (await listRoles(api, gymId)).find(
        (role) => role.name === name,
    )
    if (!role)
        throw new Error(`gym ${gymId ?? E2E_GYM_SLUG} has no role ${name}`)
    return role
}
export async function createRole(
    api: Api,
    name: string,
    permissions: string[] = [],
    gymId?: string,
) {
    return api.post<Role>(`/gyms/${await memberGym(gymId)}/roles`, {
        name,
        permissions,
    })
}
export const setRolePermissions = (
    api: Api,
    id: string,
    permissions: string[],
) => api.put<Role>(`/roles/${id}/permissions`, { permissions })
export const deleteRole = (api: Api, id: string, reassignTo?: string) =>
    api.delete(`/roles/${id}`, { reassign_to: reassignTo })

export async function addMembership(
    api: Api,
    user: string,
    roleId: string,
    gymId?: string,
) {
    return api.post<{ id: string; user: string; gym: string; role: string }>(
        `/gyms/${await memberGym(gymId)}/memberships`,
        { user, role: roleId },
    )
}
export const changeMembershipRole = (api: Api, id: string, roleId: string) =>
    api.post<{ id: string; role: string }>(`/memberships/${id}/role`, {
        role: roleId,
    })
export const deleteMembership = (api: Api, id: string) =>
    api.delete(`/memberships/${id}`)
export async function membershipOf(api: Api, userId: string, gymId?: string) {
    const path = `/gyms/${await memberGym(gymId)}/members`
    for (let page = 1; ; page++) {
        const { items } = await api.get<Page<Member>>(path, {
            page,
            limit: 500,
        })
        const member = items.find((item) => item.user.id === userId)
        if (member || items.length < 500) return member ?? null
    }
}

export async function inviteMember(
    api: Api,
    input: { email: string; role: string; firstname?: string; name?: string },
    gymId?: string,
) {
    return api.post(`/gyms/${await memberGym(gymId)}/members`, input)
}
export async function listInvites(api: Api, gymId?: string) {
    return api.get<InviteRecord[]>(`/gyms/${await memberGym(gymId)}/invites`)
}
export const revokeInvite = (api: Api, id: string) =>
    api.delete(`/invites/${id}`)
