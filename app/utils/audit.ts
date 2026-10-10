import type { AuditAction, AuditLogRecord } from '~/types/models'

export const AUDIT_ACTIONS = [
    'create',
    'update',
    'delete',
    'login',
    'login_failed',
    'password_reset_request',
    'password_reset',
    'email_change_request',
    'email_change',
] as const

export const AUDITED_COLLECTIONS: string[] = [
    'routes',
    'ratings',
    'users',
    'roles',
    'permissions',
    'settings',
    'reports',
    'tasks',
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
    return 'i-lucide-mail-check'
}

export function actionColor(action: AuditAction | string): string {
    if (action === 'create') return 'success'
    if (action === 'update') return 'info'
    if (action === 'delete') return 'error'
    if (action === 'login') return 'primary'
    if (action === 'login_failed') return 'warning'
    return 'medium-emphasis'
}

export function pbDateString(date: Date): string {
    return date.toISOString().replace('T', ' ')
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
    collectionName?: string | null,
    recordId?: string | null,
    gymSlug?: string | null,
): string | null {
    if (!collectionName || !recordId) return null
    if (collectionName === 'routes') return `/route?id=${recordId}`
    const path = AUDIT_TARGET_PATHS[collectionName]
    if (!path) return null
    return gymSlug ? `/${gymSlug}${path}` : path
}

export function isPlatformAdminEntry(
    entry: Pick<AuditLogRecord, 'actor_label'>,
) {
    const label = entry.actor_label ?? ''
    return (
        label === AUDIT_PLATFORM_LABEL ||
        label === 'superuser' ||
        label.startsWith('superuser:')
    )
}
