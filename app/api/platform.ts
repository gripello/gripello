import type {
    GymRecord,
    MembershipRecord,
    UserRecord,
} from '../../types/models'
import type { FeatureFlag } from '../../shared/utils/featureFlags'
import type { PlatformUser, PlatformUserFilter } from '../utils/platformUsers'
import { toFormData, useApi } from './client'
import type { PageQuery, PbReadOptions, RouteList } from './client'

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
    _options: PbReadOptions = {},
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

export async function getPlatformUser(
    id: string,
    _options: PbReadOptions = {},
) {
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
