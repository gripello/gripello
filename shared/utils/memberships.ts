import type { MembershipRecord } from '../../types/models'

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
