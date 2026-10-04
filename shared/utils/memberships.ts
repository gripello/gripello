import type { MembershipRecord, RoleRecord } from '../../types/models'

export function membershipIn(
    memberships: MembershipRecord[],
    gymId: string,
): MembershipRecord | undefined {
    return gymId
        ? memberships.find((membership) => membership.gym === gymId)
        : undefined
}

export function permissionsIn(
    memberships: MembershipRecord[],
    gymId: string,
): string[] {
    const permissions = membershipIn(memberships, gymId)?.expand?.role?.expand
        ?.permissions
    return (permissions ?? []).map((permission) => permission.name)
}

export function activeMemberships<
    T extends { expand?: { gym?: { active?: boolean } } },
>(memberships: readonly T[]): T[] {
    return memberships.filter((membership) => membership.expand?.gym?.active)
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
