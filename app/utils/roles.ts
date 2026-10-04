import type { RoleRecord, RecordId } from '~/types/models'

export const PROTECTED_ROLE_NAME = 'admin'

export function isProtectedRole(role: Pick<RoleRecord, 'name'>): boolean {
    return role.name === PROTECTED_ROLE_NAME
}

export function reassignTargets(
    roles: RoleRecord[],
    deletingId: RecordId,
): RoleRecord[] {
    return roles.filter((r) => r.id !== deletingId)
}

export function defaultReassignTarget(
    roles: RoleRecord[],
    deletingId: RecordId,
): RecordId | null {
    const [leastPrivileged] = reassignTargets(roles, deletingId).sort(
        (a, b) => (a.permissions?.length ?? 0) - (b.permissions?.length ?? 0),
    )
    return leastPrivileged?.id ?? null
}

export const PERMISSION_GROUPS = [
    {
        key: 'routes',
        icon: 'i-lucide-route',
        permissions: [
            'manage_routes',
            'run_inventory',
            'manage_tasks',
            'view_analytics',
        ],
    },
    {
        key: 'competitions',
        icon: 'i-lucide-trophy',
        permissions: ['manage_competitions', 'judge_competitions'],
    },
    {
        key: 'moderation',
        icon: 'i-lucide-shield-check',
        permissions: ['manage_comments', 'manage_reports'],
    },
    {
        key: 'admin',
        icon: 'i-lucide-settings',
        permissions: ['manage_users', 'manage_settings', 'view_audit_log'],
    },
] as const

export function groupPermissions<T extends { name: string }>(
    permissions: T[],
): { key: string; icon: string; permissions: T[] }[] {
    const known = new Set<string>(
        PERMISSION_GROUPS.flatMap((group) => group.permissions),
    )
    const byName = new Map(
        permissions.map((permission) => [permission.name, permission]),
    )
    const groups = PERMISSION_GROUPS.map((group) => ({
        key: group.key as string,
        icon: group.icon as string,
        permissions: group.permissions
            .map((name) => byName.get(name))
            .filter((permission) => permission !== undefined),
    }))
    const others = permissions.filter(
        (permission) => !known.has(permission.name),
    )
    return [
        ...groups,
        { key: 'other', icon: 'i-lucide-ellipsis', permissions: others },
    ].filter((group) => group.permissions.length)
}
