import type { AUDIT_ACTIONS } from '../app/utils/audit'
import type { NotificationPrefs } from '../app/utils/notificationPrefs'
import type { REPORT_REASONS, REPORT_STATUSES } from '../app/utils/reports'
import type { ROUTE_TYPES } from '../app/utils/routes'
import type {
    DEFECT_CATEGORIES,
    TASK_KINDS,
    TASK_PRIORITIES,
    TASK_STATUSES,
} from '../app/utils/tasks'
import type { TickType } from '../shared/utils/ticks'
import type {
    ClimbStyle,
    CompetitionDiscipline,
    ScoringFormat,
    ScoringSettings,
} from '../shared/utils/competitionScoring'
import type { GymMap, MapPoint } from '../shared/utils/mapGeometry'
import type { BoulderBandSetting } from '../shared/utils/gradeReference'
import type { GymFeatures } from '../shared/utils/featureFlags'

export type RecordId = string

export interface BaseRecord {
    id: RecordId
    collectionId?: string
    collectionName?: string
    created?: string
    updated?: string
    expand?: Record<string, unknown>
}

export type RouteType = (typeof ROUTE_TYPES)[number] | string

type JsonArray<T> = T[] | readonly T[]
type JsonValue<T> = T | JsonArray<T>

export interface RouteRecord extends BaseRecord {
    gym?: RecordId
    name: string
    grade: string
    grade_system?: string | null
    grade_index?: number | null
    anchor_point?: number | null
    location?: RecordId | null
    type?: RouteType | null
    comment?: string | null
    creator?: JsonValue<string> | null
    archived?: boolean
    archived_at?: string | null
    permanent?: boolean
    color?: string | null
    screw_date?: string | null
    wall?: RecordId | null
    wall_position?: number | null
}

export interface LocationRecord extends BaseRecord {
    gym?: RecordId
    name: string
    map?: GymMap | null
    map_trace?: string | null
}

export interface WallRecord extends BaseRecord {
    gym?: RecordId
    location: RecordId
    name: string
    outline: MapPoint[]
    edge: MapPoint[]
    label?: MapPoint | null
    sort?: number | null
    anchor_from?: number | null
    anchor_to?: number | null
}

export interface RouteListItem extends Omit<RouteRecord, 'creator'> {
    creator: string[]
    has_ratings?: boolean
    average_rating?: number | null
    score?: number | null
}

export interface RatingRecord extends BaseRecord {
    gym?: RecordId
    route_id?: RecordId | null
    rating?: number | null
    grade?: string | null
    grade_system?: string | null
    grade_index?: number | null
    comment?: string | null
    author?: { id: string; name: string; avatar: string }
    mine?: boolean
}

export interface TickRecord extends BaseRecord {
    user: RecordId
    route?: RecordId | null
    route_name?: string
    type: TickType
    attempts: number
    date: string
    note?: string | null
    grade?: string | null
    grade_system?: string | null
    grade_index?: number | null
}

export interface RouteComment extends RatingRecord {
    comment: string
}

export interface PermissionRecord extends BaseRecord {
    name: string
    label: string
}

export interface RoleRecord extends BaseRecord {
    gym?: RecordId
    name: string
    description?: string | null
    color?: string | null
    permissions?: RecordId[] | null
}

export interface UserRecord extends BaseRecord {
    username: string
    email?: string
    emailVisibility?: boolean
    verified?: boolean
    firstname?: string | null
    lastname?: string | null
    name?: string | null
    avatar?: string | null
    banner?: string | null
    language?: string | null
    platform_admin?: boolean
    notification_prefs?: NotificationPrefs | null
    followed_walls?: string[]
    leaderboard_hidden?: boolean
    follow_policy?: FollowPolicy | ''
    reviews_anonymous?: boolean
    ticks_private?: boolean
    suspended_until?: string
    suspension_reason?: string
}

export type FollowPolicy = 'approve' | 'open' | 'closed'
export type FollowStatus = 'pending' | 'accepted'

export interface FollowRecord extends BaseRecord {
    follower: RecordId
    followee: RecordId
    status: FollowStatus
}

export type FriendTickRecord = Omit<TickRecord, 'note'>

export interface SeasonRecord extends BaseRecord {
    gym: RecordId
    name: string
    starts_at: string
    ends_at: string
}

export interface BetaVideoRecord extends BaseRecord {
    gym: RecordId
    route: RecordId
    user: RecordId
    url?: string
    file?: string
    author?: { id: string; name: string; avatar: string }
}

export type ModerationContentType =
    'rating' | 'beta_video' | 'profile' | 'competition_entry' | 'task' | 'route'
export type ModerationState = 'unreviewed' | 'approved' | 'pending' | 'hidden'
export type ModerationAction = 'approve' | 'reject' | 'hide' | 'restore'

export interface ModerationItemRecord extends BaseRecord {
    gym: RecordId | ''
    content_type: ModerationContentType
    content_id: RecordId
    author: RecordId | ''
    snapshot: Record<string, unknown> | null
    files: string[]
    state: ModerationState
    hidden_by: 'gym' | 'platform' | ''
    reports_count: number
    reason: string
    reviewed_by: RecordId | ''
    reviewed_at: string
    context?: ModerationContext
}

export interface ModerationContext {
    author?: { id: RecordId; name: string; avatar: string }
    history?: { items: number; hidden: number }
    route?: { id: RecordId; name: string; grade: string; color: string }
    competition?: string
    gym_name?: string
    reports: {
        id: RecordId
        reason: string
        explanation: string
        notifier_name: string
        status: ReportStatus
        created: string
    }[]
}

export interface BlockRecord extends BaseRecord {
    blocker: RecordId
    blocked: RecordId
}

export interface LegalFields {
    contact_email?: string | null
    imprint_url?: string | null
    privacy_url?: string | null
    legal_address?: string | null
    legal_phone?: string | null
    legal_register?: string | null
    legal_vat_id?: string | null
    legal_editorial?: string | null
    legal_representatives?: LegalPerson[] | null
}

export interface SettingsRecord extends BaseRecord, LegalFields {
    audit_retention_days?: number | null
    allow_registration?: boolean
}

export interface GymRecord extends BaseRecord, LegalFields {
    slug: string
    previous_slugs?: string[] | null
    name: string
    unit_name?: string | null
    active?: boolean
    page_logo?: string | null
    page_icon?: string | null
    sign_image?: string | null
    route_grade_system?: string | null
    boulder_grade_system?: string | null
    boulder_bands?: BoulderBandSetting[] | null
    privacy_extra?: string | null
    language?: string | null
    features?: GymFeatures | null
    premoderate_betas?: boolean
}

export interface GymStatsRecord extends BaseRecord {
    members: number
    routes: number
}

export interface InviteRecord extends BaseRecord {
    gym: RecordId
    role: RecordId
    email: string
    firstname: string
    name: string
    expires_at: string
    expand?: { role?: RoleRecord }
}

export interface InviteDetails {
    email: string
    firstname: string
    name: string
    gym: { name: string; slug: string }
    role: string
    hasAccount: boolean
}

export interface MembershipRecord extends BaseRecord {
    user: RecordId
    gym: RecordId
    role: RecordId
    expand?: {
        user?: UserRecord
        gym?: GymRecord
        role?: RoleRecord & { expand?: { permissions?: PermissionRecord[] } }
    }
}

export interface LegalPerson {
    name: string
    role?: string
}

export type ReportContentType = 'rating' | 'route' | 'beta_video' | 'profile'
export type ReportReason = (typeof REPORT_REASONS)[number]
export type ReportStatus = (typeof REPORT_STATUSES)[number]
export type ReportDecision = 'content_removed' | 'content_kept'

export interface ReportRecord extends BaseRecord {
    gym?: RecordId
    content_type: ReportContentType
    content_id: RecordId
    content_url: string
    content_snapshot?: string | null
    reason: ReportReason
    explanation: string
    notifier_name: string
    notifier_email: string
    language?: string | null
    good_faith: boolean
    status: ReportStatus
    decision?: ReportDecision | '' | null
    decision_reason?: string | null
    decided_at?: string | null
    decided_by?: RecordId | null
    receipt_sent?: boolean
    notified_at?: string | null
}

export type TaskKind = (typeof TASK_KINDS)[number]
export type DefectCategory = (typeof DEFECT_CATEGORIES)[number]
export type TaskPriorityName = (typeof TASK_PRIORITIES)[number]
export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface TaskRecord extends BaseRecord {
    gym?: RecordId
    kind: TaskKind
    title?: string | null
    category?: DefectCategory | '' | null
    priority: number
    status: TaskStatus
    route?: RecordId | null
    wall?: RecordId | null
    location?: RecordId | null
    description?: string | null
    photo?: string | null
    reporter?: RecordId | null
    assignee?: RecordId | null
    route_type?: RouteType | '' | null
    grade?: string | null
    due_date?: string | null
    resolution_note?: string | null
    done_at?: string | null
    done_by?: RecordId | null
}

export type CompetitionStatus = 'draft' | 'open' | 'closed' | 'published'
export type CompetitionEntryStatus =
    'registered' | 'checked_in' | 'disqualified' | 'withdrawn'

export interface CompetitionRecord extends BaseRecord {
    gym?: RecordId
    name: string
    description?: string | null
    location: RecordId
    status: CompetitionStatus
    discipline: CompetitionDiscipline
    registration_url?: string | null
    requires_payment?: boolean
    starts_at: string
    ends_at: string
    scoring_format: ScoringFormat
    scoring?: Omit<ScoringSettings, 'format'> | null
    live_ranking: boolean
    freeze_minutes?: number | null
}

export interface CompetitionCategoryRecord extends BaseRecord {
    competition: RecordId
    name: string
    gender?: 'female' | 'male' | '' | null
    min_birth_year?: number | null
    max_birth_year?: number | null
    sort?: number | null
}

export interface CompetitionRouteRecord extends BaseRecord {
    competition: RecordId
    route: RecordId
    number: number
    points?: number | null
    hold_count?: number | null
    zone: boolean
    voided: boolean
}

export interface CompetitionEntryRecord extends BaseRecord {
    competition: RecordId
    user: RecordId
    category: RecordId
    bib: number
    display_name: string
    birth_year: number
    hidden: boolean
    paid: boolean
    guardian_consent: boolean
    status: CompetitionEntryStatus
}

export interface CompetitionScoreRecord extends BaseRecord {
    competition: RecordId
    entry: RecordId
    comp_route: RecordId
    attempts: number
    zone_attempt?: number | null
    top_attempt?: number | null
    style?: ClimbStyle | '' | null
    height?: number | null
    height_plus?: boolean | null
}

export interface OpenRouteDefectRecord extends BaseRecord {
    gym?: RecordId
    route: RecordId
    category: DefectCategory
}

export interface TaskAssigneeRecord extends BaseRecord {
    user: RecordId
    gym: RecordId
    name: string
}

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditLogRecord extends BaseRecord {
    gym?: RecordId
    actor?: RecordId | null
    actor_label?: string | null
    action: AuditAction
    collection_name?: string | null
    record_id?: string | null
    changed_fields?: string[] | null
    ip?: string | null
    expand?: { gym?: Pick<GymRecord, 'id' | 'slug'> }
}

export interface NotificationRecord extends BaseRecord {
    user: RecordId
    type: string
    params?: Record<string, unknown> | null
    url?: string | null
    read: boolean
}

export interface PushSubscriptionRecord extends BaseRecord {
    user: RecordId
    endpoint: string
    device?: string | null
}

export interface RouteScoreRecord extends RouteRecord {
    average_rating?: number | null
    ratings_count?: number
}

export type PocketBaseRecord =
    | RouteRecord
    | RouteListItem
    | RatingRecord
    | TickRecord
    | RouteComment
    | PermissionRecord
    | RoleRecord
    | UserRecord
    | SettingsRecord
    | GymRecord
    | MembershipRecord
    | ReportRecord
    | AuditLogRecord
    | NotificationRecord
    | RouteScoreRecord

export interface ListResult<T> {
    page: number
    perPage: number
    totalItems: number
    totalPages: number
    items: T[]
}
