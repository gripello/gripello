import type {
    ModerationAction,
    ModerationContentType,
    ModerationItemRecord,
    ModerationState,
    ReportRecord,
    ReportStatus,
} from '../../types/models'
import type { ModerationSummary } from '../utils/moderation'
import { useApi } from './client'
import type { PageQuery, PbReadOptions, RouteList } from './client'

export type ReportInput = Pick<
    ReportRecord,
    | 'content_type'
    | 'content_id'
    | 'reason'
    | 'explanation'
    | 'notifier_name'
    | 'notifier_email'
    | 'good_faith'
> &
    Partial<Pick<ReportRecord, 'language'>>

export interface ReportQuery extends PageQuery {
    status?: ReportStatus
}

export type CaseSort = 'reviewed' | 'newest'

export interface CaseQuery extends PageQuery {
    gym?: string
    state?: ModerationState[]
    content_type?: ModerationContentType | null
    author?: string
    q?: string
    queue?: 'platform'
    sort?: CaseSort
}

export interface Decision {
    id: string
    state: ModerationState
    hidden_by?: '' | 'gym' | 'platform'
}

export function createReport(
    input: ReportInput,
    headers?: Record<string, string>,
) {
    return useApi()<{ id: string }>('/reports', {
        method: 'POST',
        body: input,
        headers,
    })
}

function listReports(path: string, query: ReportQuery) {
    return useApi()<RouteList<ReportRecord>>(path, {
        query: {
            status: query.status || undefined,
            page: query.page,
            limit: query.limit,
        },
    })
}

export function listGymReports(gym: string, query: ReportQuery = {}) {
    return listReports(`/gyms/${gym}/reports`, query)
}

export function listPlatformReports(query: ReportQuery = {}) {
    return listReports('/platform/reports', query)
}

export function getModerationSummary(gym?: string) {
    return useApi()<ModerationSummary>('/moderation/summary', {
        query: { gym: gym || undefined },
    })
}

export function listCases(
    query: CaseQuery = {},
    _options: PbReadOptions = {},
): Promise<RouteList<ModerationItemRecord>> {
    return useApi()<RouteList<ModerationItemRecord>>('/moderation/cases', {
        query: {
            gym: query.gym || undefined,
            state: query.state?.length ? query.state : undefined,
            content_type: query.content_type || undefined,
            author: query.author || undefined,
            q: query.q?.trim() || undefined,
            queue: query.queue,
            sort: query.sort,
            page: query.page,
            limit: query.limit,
            total: query.total || undefined,
        },
    })
}

export function openCase(input: {
    content_type: ModerationContentType
    content_id: string
}) {
    return useApi()<Decision>('/moderation/cases', {
        method: 'POST',
        body: input,
    })
}

export function getCase(id: string) {
    return useApi()<ModerationItemRecord>(`/moderation/${id}`)
}

export function decideCase(
    id: string,
    decision: { action: ModerationAction; reason: string },
) {
    return useApi()<Decision>(`/moderation/${id}`, {
        method: 'POST',
        body: decision,
    })
}

export function hideAuthor(id: string, reason: string) {
    return useApi()<{ hidden: number }>(`/moderation/authors/${id}/hide`, {
        method: 'POST',
        body: { reason },
    })
}
