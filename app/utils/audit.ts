import type { AuditAction, AuditLogRecord, RecordId } from '~/types/models'

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

function escapeFilterValue(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

export const AUDIT_ACTOR_GUESTS = 'guests'
export const AUDIT_ACTOR_PLATFORM = 'platform'

const PLATFORM_ACTOR_FILTER =
    '(actor_label = "superuser" || actor_label ~ "superuser:%")'

function actorFilter(actor: string): string {
    if (actor === AUDIT_ACTOR_PLATFORM) return PLATFORM_ACTOR_FILTER
    if (actor === AUDIT_ACTOR_GUESTS)
        return `actor = "" && !${PLATFORM_ACTOR_FILTER}`
    return `actor = "${escapeFilterValue(actor)}"`
}

export function matchesAuditActor(
    entry: Pick<AuditLogRecord, 'actor' | 'actor_label'>,
    actor: string | null | undefined,
): boolean {
    if (!actor) return true
    if (actor === AUDIT_ACTOR_PLATFORM) return isSuperuserEntry(entry)
    if (actor === AUDIT_ACTOR_GUESTS)
        return !entry.actor && !isSuperuserEntry(entry)
    return entry.actor === actor
}

export function buildAuditFilter(options: {
    search?: string
    action?: AuditAction | null
    collection?: string | null
    period?: AuditPeriod | null
    actorId?: RecordId | null
    actor?: string | null
    gym?: RecordId | null
}): string {
    const parts: string[] = []

    if (options.actorId) {
        parts.push(`actor = "${escapeFilterValue(options.actorId)}"`)
    }
    if (options.actor) parts.push(actorFilter(options.actor))
    if (options.gym) {
        parts.push(`gym = "${escapeFilterValue(options.gym)}"`)
    }
    if (options.action) {
        parts.push(`action = "${escapeFilterValue(options.action)}"`)
    }
    if (options.collection) {
        parts.push(
            `collection_name = "${escapeFilterValue(options.collection)}"`,
        )
    }

    const period = options.period
    if (period && period !== 'all') {
        const cutoff = new Date(Date.now() - PERIOD_HOURS[period] * 3600000)
        parts.push(`created >= "${pbDateString(cutoff)}"`)
    }

    const term = (options.search ?? '').trim()
    if (term) {
        const escaped = escapeFilterValue(term)
        parts.push(
            `(actor_label ~ "${escaped}" || record_id ~ "${escaped}" || collection_name ~ "${escaped}")`,
        )
    }

    return parts.join(' && ')
}

const AUDIT_TARGET_PATHS: Record<string, string> = {
    users: '/admin/users',
    ratings: '/manage/comments',
    reports: '/manage/reports',
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

export function isSuperuserEntry(entry: Pick<AuditLogRecord, 'actor_label'>) {
    const label = entry.actor_label ?? ''
    return label === 'superuser' || label.startsWith('superuser:')
}
