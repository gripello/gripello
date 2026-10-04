import type {
    GymRecord,
    MembershipRecord,
    RoleRecord,
    UserRecord,
} from '~/types/models'
import { gymTitle } from '~/utils/gymNames'

export type PlatformUserFilter = 'platform_admins' | 'unverified'

export type PlatformUser = UserRecord & {
    expand?: { memberships_via_user?: MembershipRecord[] }
}

export interface MembershipChip {
    id: string
    gym: string
    gymTitle: string
    role: string
    roleName: string
    roleColor: string | null
}

type Filter = (raw: string, params?: Record<string, unknown>) => string

export const PLATFORM_USER_FIELDS =
    'id,collectionId,email,username,firstname,name,avatar,verified,platform_admin,created,expand.memberships_via_user.id,expand.memberships_via_user.gym,expand.memberships_via_user.role'

export function userDisplayName(user: UserRecord) {
    return (
        [user.firstname, user.name].filter(Boolean).join(' ') ||
        user.username ||
        user.email ||
        ''
    )
}

export function platformUserFilter(
    filter: Filter,
    term: string,
    kind: PlatformUserFilter | null,
    emailMatchIds: string[] = [],
) {
    const parts: string[] = []
    const needle = term.trim()
    if (needle) {
        const byId = emailMatchIds.map((id) => filter('id = {:id}', { id }))
        const fields = filter(
            'email ~ {:term} || username ~ {:term} || firstname ~ {:term} || name ~ {:term}',
            { term: needle },
        )
        parts.push(`(${[fields, ...byId].join(' || ')})`)
    }
    if (kind === 'platform_admins') parts.push('platform_admin = true')
    if (kind === 'unverified') parts.push('verified = false')
    return parts.join(' && ')
}

export function membershipChips(
    user: PlatformUser,
    gyms: GymRecord[],
    roles: RoleRecord[],
): MembershipChip[] {
    const gymById = new Map(gyms.map((gym) => [gym.id, gym]))
    const roleById = new Map(roles.map((role) => [role.id, role]))
    return (user.expand?.memberships_via_user ?? [])
        .map((membership) => {
            const gym = gymById.get(membership.gym)
            const role = roleById.get(membership.role)
            return {
                id: membership.id,
                gym: membership.gym,
                gymTitle: gym ? gymTitle(gym) : membership.gym,
                role: membership.role,
                roleName: role?.name ?? '',
                roleColor: role?.color || null,
            }
        })
        .sort((a, b) => a.gymTitle.localeCompare(b.gymTitle))
}

export function joinableGyms(chips: MembershipChip[], gyms: GymRecord[]) {
    const joined = new Set(chips.map((chip) => chip.gym))
    return gyms.filter((gym) => !joined.has(gym.id))
}

export function rolesOfGym(roles: RoleRecord[], gymId: string) {
    return roles.filter((role) => role.gym === gymId)
}
