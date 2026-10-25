import type {
    AuditLogRecord,
    GymRecord,
    RoleRecord,
    UserRecord,
} from '~/types/models'
import type { BlockSuggestions } from '~/api/platform'
import { gymTitle } from '~/utils/gymNames'
import { timeAgo } from '#shared/utils/formatting'

export const PLATFORM_USER_FILTERS = [
    'staff',
    'platform_admins',
    'unverified',
    'suspended',
    'locked',
    'no_mfa',
    'staff_no_mfa',
    'active',
    'online',
] as const

export type PlatformUserFilter = (typeof PLATFORM_USER_FILTERS)[number]

export const PLATFORM_USER_SORT_COLUMNS = [
    'email',
    'status',
    'gyms',
    'mfa',
    'last_seen',
    'created',
] as const

export type PlatformUserSortColumn = (typeof PLATFORM_USER_SORT_COLUMNS)[number]

export const PLATFORM_USER_SORTS = PLATFORM_USER_SORT_COLUMNS.flatMap(
    (column) => [column, `-${column}`] as const,
)

export type PlatformUserSort =
    PlatformUserSortColumn | `-${PlatformUserSortColumn}`

export const DEFAULT_PLATFORM_USER_SORT: PlatformUserSort = '-last_seen'

export type PlatformUser = UserRecord & {
    memberships?: { id: string; gym: string; role: string }[]
    mfa_enabled?: boolean
    session_count?: number
    last_seen?: string | null
    locked_until?: string | null
    ticks_count?: number
    ratings_count?: number
}

function pick<T extends string>(values: readonly T[], value: unknown) {
    return values.find((candidate) => candidate === value) ?? null
}

export function platformUserFilterFrom(value: unknown) {
    return pick(PLATFORM_USER_FILTERS, value)
}

export function platformUserSortFrom(value: unknown) {
    return pick(PLATFORM_USER_SORTS, value) ?? DEFAULT_PLATFORM_USER_SORT
}

// Clicking a column sorts ascending, then descending, then back to the default.
export function nextPlatformUserSort(
    current: PlatformUserSort,
    column: PlatformUserSortColumn,
): PlatformUserSort {
    if (current === column) return `-${column}`
    if (current === `-${column}`) {
        return column === 'last_seen' ? column : DEFAULT_PLATFORM_USER_SORT
    }
    return column
}

export function sortOrderOf(
    current: PlatformUserSort,
    column: PlatformUserSortColumn,
) {
    if (current === column) return 'asc'
    if (current === `-${column}`) return 'desc'
    return null
}

export type LastSeenTone = 'online' | 'active' | 'idle' | 'dormant' | 'never'

export function lastSeenTone(
    lastSeen: string | null | undefined,
    now = Date.now(),
): LastSeenTone {
    if (!lastSeen) return 'never'
    const minutes = (now - new Date(lastSeen).getTime()) / 60_000
    if (minutes < 2) return 'online'
    if (minutes < 7 * 24 * 60) return 'active'
    if (minutes < 90 * 24 * 60) return 'idle'
    return 'dormant'
}

export function lastSeenLabel(
    lastSeen: string | null | undefined,
    t: Parameters<typeof timeAgo>[1],
    locale: string,
    now = Date.now(),
) {
    const tone = lastSeenTone(lastSeen, now)
    if (tone === 'never') return t('platform.users.never')
    if (tone === 'online') return t('platform.users.onlineNow')
    return timeAgo(lastSeen, t, locale)
}

export type UserAlertKind = 'suspended' | 'locked' | 'unverified' | 'staffNoMfa'

export function userAlert(
    user: PlatformUser,
    now = new Date(),
): UserAlertKind | null {
    if (isSuspended(user, now)) return 'suspended'
    if (user.locked_until && new Date(user.locked_until) > now) return 'locked'
    if (!user.verified) return 'unverified'
    if (!user.mfa_enabled && user.memberships?.length) return 'staffNoMfa'
    return null
}

export function mergeActivity(...lists: AuditLogRecord[][]) {
    const byId = new Map(lists.flat().map((entry) => [entry.id, entry]))
    return [...byId.values()].sort((a, b) => b.created.localeCompare(a.created))
}

export interface UserSecurityState {
    isSelf: boolean
    canAct: boolean
    mfa: boolean
    sessions: number
    locked: boolean
}

export function userSecurityState(
    user: PlatformUser,
    selfId: string,
): UserSecurityState {
    const isSelf = user.id === selfId
    return {
        isSelf,
        canAct: !isSelf && !user.platform_admin,
        mfa: !!user.mfa_enabled,
        sessions: user.session_count ?? 0,
        locked: !!user.locked_until,
    }
}

export interface MembershipChip {
    id: string
    gym: string
    gymTitle: string
    role: string
    roleName: string
    roleColor: string | null
}

export function membershipChips(
    user: PlatformUser,
    gyms: GymRecord[],
    roles: RoleRecord[],
): MembershipChip[] {
    const gymById = new Map(gyms.map((gym) => [gym.id, gym]))
    const roleById = new Map(roles.map((role) => [role.id, role]))
    return (user.memberships ?? [])
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
        return new Date(`${until}T23:59:59.999`).toISOString()
    const days = duration === 'week' ? 7 : 30
    return new Date(now.getTime() + days * DAY_MS).toISOString()
}

// What the suspend dialog offers to block: the address unless already blocked, the domain only off public providers.
export function blockChoices(suggestions: BlockSuggestions | null | undefined) {
    if (!suggestions?.domain) return { email: false, domain: false }
    return {
        email: !suggestions.email_blocked && !suggestions.domain_blocked,
        domain: !suggestions.freemail && !suggestions.domain_blocked,
    }
}
