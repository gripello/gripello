import type { AuditAction, AuditLogRecord } from '../../types/models'
import { useApi } from './client'
import type { Page } from './client'

export interface AuditQuery {
    action?: AuditAction | null
    collection?: string | null
    actor?: string | null
    record?: string | null
    from?: Date | string
    to?: Date | string
    q?: string
    page?: number
    limit?: number
}

function isoDate(value?: Date | string) {
    return value instanceof Date ? value.toISOString() : value || undefined
}

function listAudit(
    path: string,
    query: AuditQuery & { gym?: string | null },
): Promise<Page<AuditLogRecord>> {
    return useApi()<Page<AuditLogRecord>>(path, {
        query: {
            gym: query.gym || undefined,
            action: query.action || undefined,
            collection: query.collection || undefined,
            actor: query.actor || undefined,
            record: query.record || undefined,
            from: isoDate(query.from),
            to: isoDate(query.to),
            q: query.q?.trim() || undefined,
            page: query.page,
            limit: query.limit,
        },
    })
}

export function listGymAudit(gym: string, query: AuditQuery = {}) {
    return listAudit(`/gyms/${gym}/audit`, query)
}

export function listPlatformAudit(
    query: AuditQuery & { gym?: string | null } = {},
) {
    return listAudit('/platform/audit', query)
}

export function listOwnAudit(query: AuditQuery = {}) {
    return listAudit('/me/audit', query)
}
