import { parseDate } from '#shared/utils/formatting'
import type {
    ModerationAction,
    ModerationContentType,
    ModerationItemRecord,
    ModerationState,
} from '~/types/models'

export const GYM_VIEWS = ['decide', 'approval', 'hidden', 'history'] as const
export const PLATFORM_VIEWS = ['decide', 'all', 'hidden', 'history'] as const
export type ModerationView =
    (typeof GYM_VIEWS)[number] | (typeof PLATFORM_VIEWS)[number]

export const MODERATION_CONTENT_TYPES: ModerationContentType[] = [
    'rating',
    'beta_video',
    'profile',
    'competition_entry',
    'task',
    'route',
]

const VIEW_STATES: Record<ModerationView, ModerationState[]> = {
    decide: ['unreviewed'],
    all: ['unreviewed', 'pending'],
    approval: ['pending'],
    hidden: ['hidden'],
    history: ['approved'],
}

export function moderationViewQuery(view: ModerationView, platform = false) {
    return {
        state: VIEW_STATES[view],
        ...(platform && view === 'decide'
            ? { queue: 'platform' as const }
            : {}),
        ...(view === 'hidden' || view === 'history'
            ? { sort: 'reviewed' as const }
            : {}),
    }
}

// Mirrors moderationAllowed in pocketbase/hooks/moderation.go.
export function moderationActions(
    item: Pick<ModerationItemRecord, 'state' | 'hidden_by'>,
    who: { platform: boolean; gymStaff: boolean },
): ModerationAction[] {
    switch (item.state) {
        case 'pending':
            return [
                ...(who.gymStaff ? (['reject', 'approve'] as const) : []),
                ...(!who.gymStaff && who.platform ? (['hide'] as const) : []),
            ]
        case 'unreviewed':
            return ['approve', 'hide']
        case 'approved':
            return ['hide']
        case 'hidden':
            return item.hidden_by !== 'platform' || who.platform
                ? ['restore']
                : []
    }
    return []
}

export function actionLabelKey(
    item: Pick<ModerationItemRecord, 'state'>,
    action: ModerationAction,
) {
    if (action === 'approve')
        return item.state === 'pending'
            ? 'moderation.actions.publish'
            : 'moderation.actions.keep'
    return `moderation.actions.${action}`
}

export const ACTIONS_NEEDING_REASON: ModerationAction[] = ['hide', 'reject']

export function openReportCount(reports: { status: string }[] = []) {
    return reports.filter((report) => report.status === 'open').length
}

const TEXT_FIELDS: Record<ModerationContentType, string[]> = {
    rating: ['comment'],
    beta_video: ['url'],
    profile: ['username', 'firstname', 'name'],
    competition_entry: ['display_name'],
    task: ['description'],
    route: ['name', 'comment'],
}

const FILE_FIELDS: Record<ModerationContentType, string[]> = {
    rating: [],
    beta_video: ['file'],
    profile: ['avatar', 'banner'],
    competition_entry: [],
    task: ['photo'],
    route: [],
}

export const CONTENT_COLLECTIONS: Record<ModerationContentType, string> = {
    rating: 'ratings',
    beta_video: 'beta_videos',
    profile: 'users',
    competition_entry: 'competition_entries',
    task: 'tasks',
    route: 'routes',
}

export const CONTENT_ICONS: Record<ModerationContentType, string> = {
    rating: 'i-lucide-message-square',
    beta_video: 'i-lucide-video',
    profile: 'i-lucide-circle-user-round',
    competition_entry: 'i-lucide-trophy',
    task: 'i-lucide-wrench',
    route: 'i-lucide-waypoints',
}

export function moderationText(
    item: Pick<ModerationItemRecord, 'content_type' | 'snapshot'>,
): string {
    return TEXT_FIELDS[item.content_type]
        .map((field) => item.snapshot?.[field])
        .filter(
            (value): value is string => typeof value === 'string' && !!value,
        )
        .join(' · ')
}

export interface ModerationFile {
    collectionName: string
    id: string
    name: string
    video: boolean
}

export function moderationFiles(
    item: Pick<
        ModerationItemRecord,
        'id' | 'content_type' | 'content_id' | 'snapshot' | 'files' | 'state'
    >,
): ModerationFile[] {
    const video = item.content_type === 'beta_video'
    if (item.state === 'hidden' || item.state === 'pending')
        return (item.files ?? []).map((name) => ({
            collectionName: 'moderation_items',
            id: item.id,
            name,
            video,
        }))
    return FILE_FIELDS[item.content_type].flatMap((field) => {
        const value = item.snapshot?.[field]
        const names = Array.isArray(value) ? value : [value]
        return names
            .filter(
                (name): name is string => typeof name === 'string' && !!name,
            )
            .map((name) => ({
                collectionName: CONTENT_COLLECTIONS[item.content_type],
                id: item.content_id,
                name,
                video,
            }))
    })
}

export function decisionReason(preset: string, explanation: string) {
    const text = explanation.trim()
    if (!preset) return text
    return text ? `${preset}: ${text}` : preset
}

export function isNewSince(
    created: string | undefined,
    seen: string | undefined,
) {
    const createdAt = parseDate(created)
    const seenAt = parseDate(seen)
    return !!createdAt && !!seenAt && createdAt > seenAt
}

export function viewOfState(
    state: ModerationItemRecord['state'],
    platform: boolean,
): ModerationView {
    if (state === 'pending') return platform ? 'all' : 'approval'
    if (state === 'hidden') return 'hidden'
    if (state === 'approved') return 'history'
    return platform ? 'all' : 'decide'
}

export interface ModerationSummary {
    decide: number
    waiting?: number
    hidden?: number
    legal_reports?: number
    profiles?: number
    suspended?: number
    gyms?: { gym: string; open: number; oldest: string }[]
}

export function moderationBadgeCount(summary: ModerationSummary) {
    return summary.decide + (summary.waiting ?? 0)
}
