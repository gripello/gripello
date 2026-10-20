import type { AUDIT_ACTIONS } from '../shared/utils/audit'
import type { REPORT_REASONS, REPORT_STATUSES } from '../shared/utils/reports'
import type { ROUTE_TYPES } from '../shared/utils/routeTypes'
import type {
    DEFECT_CATEGORIES,
    TASK_KINDS,
    TASK_PRIORITIES,
    TASK_STATUSES,
} from '../shared/utils/tasks'
import type { MapPoint } from '../shared/utils/mapGeometry'
import type { BoulderBandSetting } from '../shared/utils/gradeReference'
import type { components as TicksApi } from './api/ticks'
import type { components as RatingsApi } from './api/ratings'
import type { components as SocialApi } from './api/social'
import type { components as NotificationsApi } from './api/notifications'
import type { components as AuditApi } from './api/audit'
import type { components as AuthnApi } from './api/authn'
import type { components as TasksApi } from './api/tasks'
import type { components as ModerationApi } from './api/moderation'
import type { components as MembersApi } from './api/members'
import type { components as GymsApi } from './api/gyms'
import type { components as CompetitionsApi } from './api/competitions'
import type { components as RoutesApi } from './api/routes'
import type { operations as PlatformApi } from './api/platform'

export type RecordId = string

export type RouteType = (typeof ROUTE_TYPES)[number] | string

export type RouteRecord = RoutesApi['schemas']['Route']

export type LocationRecord = RoutesApi['schemas']['Location']

export type WallRecord = Omit<
    RoutesApi['schemas']['Wall'],
    'outline' | 'edge' | 'label'
> & { outline: MapPoint[]; edge: MapPoint[]; label: MapPoint | null }

export type RouteListItem = RouteRecord & {
    has_ratings?: boolean
    score?: number | null
}

export type RatingRecord = RatingsApi['schemas']['Rating']

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

// Offline ticks are shown before the server has copied the route's snapshot into them.
export type TickRecord = Optional<
    TicksApi['schemas']['Tick'],
    'grade' | 'grade_system' | 'grade_index' | 'route_name'
>

export type PermissionRecord = GymsApi['schemas']['Permission']

export type RoleRecord = MembersApi['schemas']['Role']

export type UserRecord = AuthnApi['schemas']['User']

export type FollowPolicy = 'approve' | 'open' | 'closed'
export type FollowStatus = 'pending' | 'accepted'

export type FollowRecord = SocialApi['schemas']['Follow']

export type FriendTickRecord = Omit<TickRecord, 'note'>

export type SeasonRecord = TicksApi['schemas']['Season']

export type BetaVideoRecord = RatingsApi['schemas']['BetaVideo']

export type ModerationContentType =
    ModerationApi['schemas']['ModerationContentType']
export type ModerationState = ModerationApi['schemas']['ModerationState']
export type ModerationAction = ModerationApi['schemas']['ModerationAction']

export type ModerationItemRecord = ModerationApi['schemas']['ModerationItem']

export type ModerationContext = ModerationApi['schemas']['ModerationContext']

export type BlockRecord = SocialApi['schemas']['Block']

export type LegalFields = Partial<
    Pick<
        GymRecord,
        | 'contact_email'
        | 'imprint_url'
        | 'privacy_url'
        | 'legal_address'
        | 'legal_phone'
        | 'legal_register'
        | 'legal_vat_id'
        | 'legal_editorial'
        | 'legal_representatives'
    >
> & { privacy_doc?: GymsApi['schemas']['PrivacyDoc'] }

export type SettingsRecord = Omit<
    GymsApi['schemas']['Settings'],
    'legal_representatives'
> & { legal_representatives: LegalPerson[] | null }

export type GymRecord = Omit<
    GymsApi['schemas']['Gym'],
    'boulder_bands' | 'legal_representatives'
> & {
    boulder_bands: BoulderBandSetting[] | null
    legal_representatives: LegalPerson[] | null
}

export type GymStatsRecord =
    PlatformApi['platformStats']['responses'][200]['content']['application/json']['gyms'][number]

export type InviteRecord = MembersApi['schemas']['Invite']

export type InviteDetails = MembersApi['schemas']['InvitePreview']

export type MembershipRecord = MembersApi['schemas']['Membership']

export interface LegalPerson {
    name: string
    role?: string
}

export type ReportContentType = 'rating' | 'route' | 'beta_video' | 'profile'
export type ReportReason = (typeof REPORT_REASONS)[number]
export type ReportStatus = (typeof REPORT_STATUSES)[number]
export type ReportDecision = 'content_removed' | 'content_kept'

export type ReportRecord = ModerationApi['schemas']['Report']

export type TaskKind = (typeof TASK_KINDS)[number]
export type DefectCategory = (typeof DEFECT_CATEGORIES)[number]
export type TaskPriorityName = (typeof TASK_PRIORITIES)[number]
export type TaskStatus = (typeof TASK_STATUSES)[number]

export type TaskRecord = TasksApi['schemas']['Task']

export type CompetitionStatus = 'draft' | 'open' | 'closed' | 'published'
export type CompetitionEntryStatus =
    'registered' | 'checked_in' | 'disqualified' | 'withdrawn'

export type CompetitionRecord = CompetitionsApi['schemas']['Competition']

export type CompetitionCategoryRecord = CompetitionsApi['schemas']['Category']

export type CompetitionRouteRecord = CompetitionsApi['schemas']['CompRoute']

export type CompetitionEntryRecord = CompetitionsApi['schemas']['Entry']

export type CompetitionScoreRecord = CompetitionsApi['schemas']['Score']

export type OpenRouteDefectRecord = TasksApi['schemas']['OpenDefect']

export type TaskAssigneeRecord = TasksApi['schemas']['TaskAssignee']

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type AuditLogRecord = AuditApi['schemas']['AuditEntry']

export type NotificationRecord = NotificationsApi['schemas']['Notification']

export type SessionRecord = AuthnApi['schemas']['Session']

export type PushSubscriptionRecord =
    NotificationsApi['schemas']['PushSubscription']
