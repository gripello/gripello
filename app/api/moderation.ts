import type {
    ModerationAction,
    ModerationContentType,
    ModerationItemRecord,
    ModerationState,
    ReportRecord,
} from '../../types/models'
import type { ModerationSummary } from '../utils/moderation'
import { useApi } from './client'
import type { PageQuery, Page } from './client'

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

export function moderationSummary(gym?: string) {
    return useApi()<ModerationSummary>('/moderation/summary', {
        query: { gym: gym || undefined },
    })
}

export function listModerationCases(
    query: CaseQuery = {},
): Promise<Page<ModerationItemRecord>> {
    return useApi()<Page<ModerationItemRecord>>('/moderation/cases', {
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

export function openModerationCase(input: {
    content_type: ModerationContentType
    content_id: string
}) {
    return useApi()<Decision>('/moderation/cases', {
        method: 'POST',
        body: input,
    })
}

export function getModerationCase(id: string) {
    return useApi()<ModerationItemRecord>(`/moderation/${id}`)
}

export function decideModerationCase(
    id: string,
    decision: { action: ModerationAction; reason: string },
) {
    return useApi()<Decision>(`/moderation/${id}`, {
        method: 'POST',
        body: decision,
    })
}

export function hideAuthorContent(id: string, reason: string) {
    return useApi()<{ hidden: number }>(`/moderation/authors/${id}/hide`, {
        method: 'POST',
        body: { reason },
    })
}
