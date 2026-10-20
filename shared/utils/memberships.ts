import type { RoleRecord } from '../../types/models'

export function membershipIn<T extends { gym: { id: string } }>(
    memberships: readonly T[],
    gymId: string,
): T | undefined {
    return gymId
        ? memberships.find((membership) => membership.gym.id === gymId)
        : undefined
}

export function permissionsIn(
    memberships: readonly {
        gym: { id: string }
        role: { permissions: string[] }
    }[],
    gymId: string,
): string[] {
    return membershipIn(memberships, gymId)?.role.permissions ?? []
}

export function activeMemberships<T extends { gym: { active: boolean } }>(
    memberships: readonly T[],
): T[] {
    return memberships.filter((membership) => membership.gym.active)
}

type GrantRole = Pick<RoleRecord, 'name' | 'permissions'>

export function canGrantRole(
    role: GrantRole,
    callerRole: GrantRole | undefined,
    platformAdmin: boolean,
): boolean {
    if (platformAdmin) return true
    if (!callerRole) return false
    if (role.name === 'admin' && callerRole.name !== 'admin') return false
    const held = callerRole.permissions ?? []
    return (role.permissions ?? []).every((permission) =>
        held.includes(permission),
    )
}
