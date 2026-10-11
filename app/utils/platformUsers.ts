import type {
    GymRecord,
    MembershipRecord,
    RoleRecord,
    UserRecord,
} from '~/types/models'
import { gymTitle } from '~/utils/gymNames'

export type PlatformUserFilter = 'platform_admins' | 'unverified' | 'suspended'

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

export function userDisplayName(user: UserRecord) {
    return (
        [user.firstname, user.name].filter(Boolean).join(' ') ||
        user.username ||
        user.email ||
        ''
    )
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

export function userKeptThroughReload(
    users: PlatformUser[],
    id: string | null,
    previous: PlatformUser | null | undefined,
) {
    return (
        users.find((user) => user.id === id) ??
        (previous && previous.id === id ? previous : null)
    )
}

export function isPermanentlySuspended(
    user: Pick<UserRecord, 'suspended_until'>,
) {
    return !!user.suspended_until && user.suspended_until.startsWith('9999-')
}

export function isSuspended(
    user: Pick<UserRecord, 'suspended_until'>,
    now = new Date(),
) {
    return !!user.suspended_until && new Date(user.suspended_until) > now
}

export type SuspensionDuration = 'week' | 'month' | 'until' | 'permanent'

const DAY_MS = 86_400_000

export function suspensionEnd(
    duration: SuspensionDuration,
    until: string,
    now = new Date(),
): string | null {
    if (duration === 'permanent') return null
    // The chosen day counts in full, in the admin's own time zone.
    if (duration === 'until')
        return new Date(`${until}T23:59:59.999`).toISOString().replace('T', ' ')
    const days = duration === 'week' ? 7 : 30
    return new Date(now.getTime() + days * DAY_MS)
        .toISOString()
        .replace('T', ' ')
}
