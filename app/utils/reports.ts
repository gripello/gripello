import type { ReportContentType, RecordId } from '~/types/models'

export const REPORT_REASONS = [
    'hate_speech',
    'harassment',
    'violence_threat',
    'sexual_content',
    'personal_data',
    'ip_infringement',
    'spam_fraud',
    'other',
] as const

export const REPORT_STATUSES = ['open', 'actioned', 'rejected'] as const

export function reportContentUrl(
    type: ReportContentType,
    id: RecordId,
    routeId?: RecordId | null,
): string {
    if (type === 'route') return `/route?id=${id}`
    if (type === 'profile') return `/climber?id=${id}`
    if (type === 'beta_video') return `/route?id=${routeId}#beta-${id}`
    return routeId ? `/route?id=${routeId}#comment-${id}` : `#comment-${id}`
}
