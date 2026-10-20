import {
    gradeIndex,
    compareGradeKeys,
    isGradeSystem,
    nearestGrade,
    type GradeSource,
} from './grades'

export const ANALYTICS_RANGES = ['30d', '90d', '12m', 'all', 'custom'] as const
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]

export const GRADE_DEVIATION_THRESHOLD = 1.5

export interface AnalyticsQuery {
    range?: string
    from?: string
    to?: string
    location?: string
    type?: string
    archived?: string
}

export interface Trend {
    value: number
    previous: number | null
}

export interface TimelineDatum {
    period: string
    count: number
}

export interface GradeDatum {
    grade: string
    total: number
    expected: number
}

export interface RouteSummary {
    id: string
    name: string
    grade: string
    type: string | null
    location: string | null
    creators: string[]
    screwDate: string | null
}

export interface RatedRoute extends RouteSummary {
    averageRating: number
    ratings: number
}

export interface FeedbackRoute extends RouteSummary {
    gradeSystem: string
    setGrade: number
    votedGrade: number
    votedGradeLabel: string
    deviation: number
    votes: number
}

export interface SetterStats {
    setter: string
    routes: number
    routesInPeriod: number
    averageRating: number | null
    averageDeviation: number | null
}

export interface AgedRoute extends RouteSummary {
    ageDays: number
}

export interface LocationGradeDatum {
    location: string
    grade: string
    count: number
}

export interface LatestComment {
    id: string
    routeId: string | null
    routeName: string
    rating: number | null
    comment: string
    created: string | null
}

export const DISCIPLINES = ['Boulder', 'Route'] as const
export type Discipline = (typeof DISCIPLINES)[number]

export interface GradeAnalytics {
    gradeDistribution: GradeDatum[]
    locationGrades: LocationGradeDatum[]
    gradeFeedback: FeedbackRoute[]
}

export interface AnalyticsResponse {
    generatedAt: string
    period: { from: string | null; to: string }
    bucket: Bucket
    summary: {
        activeRoutes: number
        routesSet: Trend
        ratings: Trend
        averageRating: Trend
        comments: Trend
        averageLifespanDays: number | null
        unratedRoutes: number
    }
    grades: Record<Discipline, GradeAnalytics>
    routeTimeline: TimelineDatum[]
    ratingTimeline: TimelineDatum[]
    commentTimeline: TimelineDatum[]
    dailyRouteActivity: TimelineDatum[]
    ratingDistribution: number[]
    setters: SetterStats[]
    ratingBaseline: number | null
    topRated: RatedRoute[]
    lowestRated: RatedRoute[]
    oldestActive: AgedRoute[]
    latestComments: LatestComment[]
}

export type Bucket = 'day' | 'week' | 'month'

export interface AnalyticsPayload extends Omit<AnalyticsResponse, 'grades'> {
    grades: Record<
        Discipline,
        Omit<GradeAnalytics, 'gradeFeedback'> & {
            gradeFeedback: Omit<FeedbackRoute, 'votedGradeLabel'>[]
        }
    >
}

export function gradeScore(source: GradeSource): number | null {
    const storedIndex = source.grade_index
    const index =
        typeof storedIndex === 'number' && storedIndex > 0
            ? storedIndex
            : gradeIndex(source.grade_system, source.grade)
    return typeof index === 'number' && Number.isFinite(index) ? index : null
}

export function compareGrades(left: string, right: string): number {
    return compareGradeKeys(left, right) || left.localeCompare(right)
}

export function labelAnalytics(payload: AnalyticsPayload): AnalyticsResponse {
    const label = (grades: AnalyticsPayload['grades'][Discipline]) => ({
        ...grades,
        gradeDistribution: [...grades.gradeDistribution].sort((a, b) =>
            compareGrades(a.grade, b.grade),
        ),
        gradeFeedback: grades.gradeFeedback.map((row) => ({
            ...row,
            votedGradeLabel: isGradeSystem(row.gradeSystem)
                ? nearestGrade(row.gradeSystem, row.votedGrade)
                : '',
        })),
    })
    return {
        ...payload,
        grades: {
            Boulder: label(payload.grades.Boulder),
            Route: label(payload.grades.Route),
        },
    }
}

export function routeAge(days: number): {
    unit: 'days' | 'months' | 'years'
    n: number
} {
    if (days < 60) return { unit: 'days', n: days }
    if (days < 730) return { unit: 'months', n: Math.round(days / 30.44) }
    return { unit: 'years', n: Math.round(days / 365.25) }
}
