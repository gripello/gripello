import type { AuditAction, AuditLogRecord } from '~/types/models'

export const AUDITED_COLLECTIONS: string[] = [
    'routes',
    'ratings',
    'users',
    'roles',
    'permissions',
    'settings',
    'reports',
    'tasks',
    'platform_config',
    'oauth2_providers',
    'retired_slugs',
    'backups',
]

export type AuditPeriod = '24h' | '7d' | '30d' | 'all'

export const AUDIT_PERIODS: AuditPeriod[] = ['24h', '7d', '30d', 'all']

const PERIOD_HOURS: Record<Exclude<AuditPeriod, 'all'>, number> = {
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30,
}

export function auditPeriodStart(period?: AuditPeriod | null) {
    if (!period || period === 'all') return undefined
    return new Date(Date.now() - PERIOD_HOURS[period] * 3600000)
}

export function isRecordAction(action: AuditAction | string): boolean {
    return action === 'create' || action === 'update' || action === 'delete'
}

export function compressIp(ip?: string | null): string {
    if (!ip) return ''
    const groups = ip.split(':')
    if (groups.length !== 8) return ip
    const trimmed = groups.map((g) => g.replace(/^0+(?=.)/, ''))

    let bestStart = -1
    let bestLen = 0
    let runStart = -1
    let runLen = 0
    trimmed.forEach((g, i) => {
        if (g !== '0') {
            runStart = -1
            runLen = 0
            return
        }
        if (runStart < 0) runStart = i
        runLen += 1
        if (runLen > bestLen) {
            bestLen = runLen
            bestStart = runStart
        }
    })

    if (bestLen < 2) return trimmed.join(':')
    return `${trimmed.slice(0, bestStart).join(':')}::${trimmed.slice(bestStart + bestLen).join(':')}`
}

export function actionIcon(action: AuditAction | string): string {
    if (action === 'create') return 'i-lucide-circle-plus'
    if (action === 'update') return 'i-lucide-pencil'
    if (action === 'delete') return 'i-lucide-trash-2'
    if (action === 'login') return 'i-lucide-log-in'
    if (action === 'login_failed') return 'i-lucide-user-round-x'
    if (action === 'password_reset' || action === 'password_reset_request') {
        return 'i-lucide-rotate-ccw'
    }
    if (action === 'register' || action === 'register_existing') {
        return 'i-lucide-user-plus'
    }
    if (action === 'email_verified') return 'i-lucide-badge-check'
    return 'i-lucide-mail-check'
}

export function actionColor(action: AuditAction | string): string {
    if (action === 'create' || action === 'register') return 'success'
    if (action === 'update') return 'info'
    if (action === 'delete') return 'error'
    if (action === 'login') return 'primary'
    if (action === 'login_failed' || action === 'register_existing') {
        return 'warning'
    }
    return 'medium-emphasis'
}

export const AUDIT_ACTOR_GUESTS = 'guest'
export const AUDIT_ACTOR_PLATFORM = 'platform'
export const AUDIT_PLATFORM_LABEL = 'Platform administrator'

export function matchesAuditActor(
    entry: Pick<AuditLogRecord, 'actor' | 'actor_label'>,
    actor: string | null | undefined,
): boolean {
    if (!actor) return true
    if (actor === AUDIT_ACTOR_PLATFORM) return isPlatformAdminEntry(entry)
    if (actor === AUDIT_ACTOR_GUESTS)
        return !entry.actor && !isPlatformAdminEntry(entry)
    return entry.actor === actor
}

const AUDIT_TARGET_PATHS: Record<string, string> = {
    users: '/admin/users',
    ratings: '/manage/comments',
    reports: '/manage/moderation',
    moderation_items: '/manage/moderation',
    tasks: '/manage/tasks',
}

export function auditTargetUrl(
    table?: string | null,
    recordId?: string | null,
    gymSlug?: string | null,
): string | null {
    if (!table || !recordId) return null
    if (table === 'routes') return `/route?id=${recordId}`
    const path = AUDIT_TARGET_PATHS[table]
    if (!path) return null
    return gymSlug ? `/${gymSlug}${path}` : path
}

export function isPlatformAdminEntry(
    entry: Pick<AuditLogRecord, 'actor_label'>,
) {
    return entry.actor_label === AUDIT_PLATFORM_LABEL
}
