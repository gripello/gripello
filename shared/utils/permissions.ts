export const PERMISSIONS = [
    'judge_competitions',
    'manage_comments',
    'manage_competitions',
    'manage_reports',
    'manage_routes',
    'manage_settings',
    'manage_tasks',
    'manage_users',
    'run_inventory',
    'view_analytics',
    'view_audit_log',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const PLATFORM_ADMIN = 'platform_admin'

export type PermissionCheck = Permission | typeof PLATFORM_ADMIN

export type PermissionRequirement = PermissionCheck | readonly PermissionCheck[]

export const MODERATION_PERMISSIONS = [
    'manage_comments',
    'manage_reports',
] as const satisfies readonly Permission[]

export function meetsRequirement(
    requirement: PermissionRequirement,
    can: (permission: PermissionCheck) => boolean,
): boolean {
    return typeof requirement === 'string'
        ? can(requirement)
        : requirement.some((permission) => can(permission))
}
