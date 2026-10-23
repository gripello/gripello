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
