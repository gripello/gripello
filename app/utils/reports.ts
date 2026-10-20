import type { ReportContentType, RecordId } from '~/types/models'

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
