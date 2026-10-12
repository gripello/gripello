import type {
    GymRecord,
    MembershipRecord,
    UserRecord,
} from '../../types/models'
import type { FeatureFlag } from '../../shared/utils/featureFlags'
import type { PlatformUser, PlatformUserFilter } from '../utils/platformUsers'
import { toFormData, useApi } from './client'
import type { PageQuery, RouteList } from './client'

export interface PlatformUserQuery extends PageQuery {
    q?: string
    filter?: PlatformUserFilter | null
}

export type PlatformUserInput = Partial<
    Pick<UserRecord, 'username' | 'firstname' | 'name' | 'email' | 'verified'>
>

export type PlatformUserFiles = Partial<
    Record<'avatar' | 'banner', File | null>
>

export type Suspension = { reason: string } & (
    { until: string; permanent?: never } | { permanent: true; until?: never }
)

export interface PlatformStats {
    gyms: Array<
        Pick<GymRecord, 'id' | 'slug' | 'name' | 'active'> & {
            members: number
            routes: number
        }
    >
    totals: {
        gyms: number
        active_gyms: number
        members: number
        routes: number
        users: number
    }
}

type ApiPlatformUser = UserRecord & {
    memberships?: Pick<MembershipRecord, 'id' | 'gym' | 'role'>[]
}

function toPlatformUser({ memberships, ...user }: ApiPlatformUser) {
    return {
        ...user,
        expand: {
            memberships_via_user: (memberships ?? []).map((membership) => ({
                ...membership,
                user: user.id,
            })) as MembershipRecord[],
        },
    } as PlatformUser
}

export async function listPlatformUsers(
    query: PlatformUserQuery = {},
): Promise<RouteList<PlatformUser>> {
    const result = await useApi()<RouteList<ApiPlatformUser>>(
        '/platform/users',
        {
            query: {
                q: query.q?.trim() || undefined,
                filter: query.filter || undefined,
                page: query.page,
                limit: query.page ? query.limit : 0,
            },
        },
    )
    return { ...result, items: result.items.map(toPlatformUser) }
}

export async function getPlatformUser(id: string) {
    return toPlatformUser(
        await useApi()<ApiPlatformUser>(`/platform/users/${id}`),
    )
}

export async function updatePlatformUser(
    id: string,
    patch: PlatformUserInput,
    files: PlatformUserFiles = {},
) {
    const body = { ...patch, ...files }
    const multipart = Object.values(files).some((file) => file instanceof Blob)
    return toPlatformUser(
        await useApi()<ApiPlatformUser>(`/platform/users/${id}`, {
            method: 'PATCH',
            body: multipart ? toFormData(body) : body,
        }),
    )
}

export function deletePlatformUser(id: string) {
    return useApi()(`/platform/users/${id}`, { method: 'DELETE' })
}

export function suspendUser(id: string, suspension: Suspension) {
    return useApi()(`/platform/users/${id}/suspension`, {
        method: 'POST',
        body: suspension,
    })
}

export function liftSuspension(id: string) {
    return useApi()(`/platform/users/${id}/suspension`, { method: 'DELETE' })
}

export function getPlatformStats() {
    return useApi()<PlatformStats>('/platform/stats')
}

export type TrafficRange = '1h' | '24h' | '7d' | '30d'

export interface TrafficTotals {
    requests: number
    client_errors: number
    server_errors: number
    p95_ms: number
}

export interface TrafficEndpoint extends TrafficTotals {
    method: string
    pattern: string
    avg_ms: number
}

export interface ServerReplica {
    name: string
    version: string
    role: string
    started: string
    last_seen: string
    online: boolean
    realtime_clients: number
    memory_bytes: number
}

export interface PlatformTraffic {
    range: TrafficRange
    step_seconds: number
    series: Array<{
        t: string
        requests: number
        client_errors: number
        server_errors: number
    }>
    totals: TrafficTotals
    previous: TrafficTotals
    peak_rps: number
    visitors_per_day: number
    endpoints: TrafficEndpoint[]
    people: {
        online: number
        signed_in: number
        new_accounts: number
        failed_logins: number
        sign_in_methods: Record<string, number>
    }
    system: {
        version: string
        replicas: ServerReplica[]
        database_bytes: number
        database_connections: number
        jobs_waiting: number
        jobs_running: number
        last_backup: string | null
        backup_error: string
        mail_configured?: boolean
    }
}

export function getPlatformTraffic(range: TrafficRange) {
    return useApi()<PlatformTraffic>('/platform/traffic', { query: { range } })
}

export function listFeatureFlags() {
    return useApi()<{ flags: FeatureFlag[] }>('/platform/features')
}

export function setGymFeatures(
    gymId: string,
    features: Partial<Record<FeatureFlag, boolean>>,
) {
    return useApi()<GymRecord>(`/platform/gyms/${gymId}/features`, {
        method: 'PUT',
        body: features,
    })
}

export async function grantPlatformAdmin(user: string) {
    return toPlatformUser(
        await useApi()<ApiPlatformUser>('/platform/admins', {
            method: 'POST',
            body: { user },
        }),
    )
}

export function revokePlatformAdmin(user: string) {
    return useApi()(`/platform/admins/${user}`, { method: 'DELETE' })
}

export function resetUserMfa(user: string) {
    return useApi()(`/platform/users/${user}/mfa`, { method: 'DELETE' })
}

export function revokeUserSessions(user: string) {
    return useApi()(`/platform/users/${user}/sessions`, { method: 'DELETE' })
}

export function clearUserLockout(user: string) {
    return useApi()(`/platform/users/${user}/lockout`, { method: 'DELETE' })
}

export function setUserPassword(
    user: string,
    password: string,
    passwordConfirm: string,
) {
    return useApi()(`/platform/users/${user}/password`, {
        method: 'POST',
        body: { password, passwordConfirm },
    })
}

export interface MailSettings {
    smtp_host: string
    smtp_port: number
    smtp_username: string
    smtp_password_set: boolean
    smtp_tls: boolean
    sender_address: string
    sender_name: string
    source: 'database' | 'environment' | 'none'
}

export type MailSettingsInput = Omit<
    MailSettings,
    'smtp_password_set' | 'source'
> & { smtp_password?: string }

export function getMailSettings() {
    return useApi()<MailSettings>('/platform/mail')
}

export function updateMailSettings(input: MailSettingsInput) {
    return useApi()<MailSettings>('/platform/mail', {
        method: 'PUT',
        body: input,
    })
}

export function sendTestMail() {
    return useApi()('/platform/mail/test', { method: 'POST' })
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ServerLogEntry {
    time: string
    replica: string
    level: string
    message: string
    attrs?: Record<string, unknown>
}

export interface ServerLogs {
    level: string
    replicas: ServerReplica[]
    items: ServerLogEntry[]
}

export function listServerLogs(level: LogLevel) {
    return useApi()<ServerLogs>('/platform/logs', { query: { level } })
}

export function setLogLevel(level: LogLevel) {
    return useApi()<{ level: LogLevel }>('/platform/logs/level', {
        method: 'PUT',
        body: { level },
    })
}

export interface OAuthProviderSettings {
    provider: 'google' | 'apple' | 'microsoft' | 'oidc'
    enabled: boolean
    client_id: string
    client_secret_set: boolean
    display_name: string
    issuer_url: string
    tenant: string
    team_id: string
    key_id: string
    private_key_set: boolean
    redirect_uri: string
}

export type OAuthProviderInput = Pick<
    OAuthProviderSettings,
    | 'enabled'
    | 'client_id'
    | 'display_name'
    | 'issuer_url'
    | 'tenant'
    | 'team_id'
    | 'key_id'
> & { client_secret?: string; private_key?: string }

export async function listOAuthProviderSettings() {
    const { items } = await useApi()<{ items: OAuthProviderSettings[] }>(
        '/platform/oauth2',
    )
    return items
}

export async function saveOAuthProviderSettings(
    provider: string,
    input: OAuthProviderInput,
) {
    const { items } = await useApi()<{ items: OAuthProviderSettings[] }>(
        `/platform/oauth2/${provider}`,
        { method: 'PUT', body: input },
    )
    return items
}
