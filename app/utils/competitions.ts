import type {
    CompetitionRouteRecord,
    CompetitionCategoryRecord,
    CompetitionRecord,
    CompetitionStatus,
} from '~/types/models'
import {
    DEFAULT_ATTEMPT_FACTORS,
    DEFAULT_TOP_POOL,
    DEFAULT_TOPROPE_FACTOR,
    IFSC_ATTEMPT_PENALTY,
    IFSC_TOP_POINTS,
    IFSC_ZONE_POINTS,
    JUDGE_ONLY_FORMATS,
    type ScoringSettings,
} from '#shared/utils/competitionScoring'

export type CategoryDraft = Pick<
    CompetitionCategoryRecord,
    'name' | 'gender' | 'min_birth_year' | 'max_birth_year' | 'sort'
>

export function defaultCategories(t: (key: string) => string): CategoryDraft[] {
    return [
        {
            name: t('competitions.defaultCategories.female'),
            gender: 'female',
            sort: 1,
        },
        {
            name: t('competitions.defaultCategories.male'),
            gender: 'male',
            sort: 2,
        },
    ]
}

export function scoringSettingsOf(
    competition: Pick<CompetitionRecord, 'scoring' | 'scoring_format'>,
): ScoringSettings {
    return {
        topPool: DEFAULT_TOP_POOL,
        attemptFactors: DEFAULT_ATTEMPT_FACTORS,
        ...competition.scoring,
        format: competition.scoring_format,
    }
}

export function nextRouteNumber(
    routes: Pick<CompetitionRouteRecord, 'number'>[],
): number {
    return (
        routes.reduce((highest, route) => Math.max(highest, route.number), 0) +
        1
    )
}

export function birthYearRange(
    category: Pick<CategoryDraft, 'min_birth_year' | 'max_birth_year'>,
): string {
    const from = category.min_birth_year || null
    const to = category.max_birth_year || null
    if (from && to) return `${from}–${to}`
    if (from) return `${from}+`
    if (to) return `≤ ${to}`
    return ''
}

const pad = (value: number) => String(value).padStart(2, '0')

export function toDateTimeInput(value: string | null | undefined): string {
    if (!value) return ''
    const date = new Date(value.replace(' ', 'T'))
    if (Number.isNaN(date.getTime())) return ''
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromDateTimeInput(value: string): string {
    if (!value) return ''
    const date = new Date(value)
    return Number.isNaN(date.getTime())
        ? ''
        : date.toISOString().replace('T', ' ')
}

export function copiedCompetition(
    competition: CompetitionRecord,
    copyName: string,
): Omit<
    CompetitionRecord,
    'id' | 'created' | 'updated' | 'collectionId' | 'collectionName' | 'expand'
> {
    return {
        name: copyName,
        description: competition.description,
        location: competition.location,
        status: 'draft',
        discipline: competition.discipline,
        registration_url: competition.registration_url,
        requires_payment: competition.requires_payment,
        starts_at: competition.starts_at,
        ends_at: competition.ends_at,
        scoring_format: competition.scoring_format,
        scoring: competition.scoring,
        live_ranking: competition.live_ranking,
        freeze_minutes: competition.freeze_minutes,
    }
}

export const COMPETITION_PHASES = [
    'draft',
    'registration',
    'running',
    'ended',
    'published',
] as const
export type CompetitionPhase = (typeof COMPETITION_PHASES)[number]

export const COMPETITION_PHASE_COLORS: Record<
    CompetitionPhase,
    'neutral' | 'success' | 'warning' | 'info' | 'primary'
> = {
    draft: 'neutral',
    registration: 'primary',
    running: 'success',
    ended: 'warning',
    published: 'info',
}

export function competitionPhase(
    competition: Pick<CompetitionRecord, 'status' | 'starts_at' | 'ends_at'>,
    now: Date,
): CompetitionPhase {
    if (competition.status === 'draft') return 'draft'
    if (competition.status === 'published') return 'published'
    if (competition.status === 'closed') return 'ended'
    if (now < new Date(competition.starts_at.replace(' ', 'T'))) {
        return 'registration'
    }
    if (now <= new Date(competition.ends_at.replace(' ', 'T'))) {
        return 'running'
    }
    return 'ended'
}

export function acceptsRegistrations(
    competition: Pick<CompetitionRecord, 'status' | 'ends_at'>,
    now: Date,
): boolean {
    return (
        competition.status === 'open' &&
        now < new Date(competition.ends_at.replace(' ', 'T'))
    )
}

export type SetupStep = 'details' | 'categories' | 'routes' | 'points' | 'holds'

export interface SetupState {
    competition: Pick<CompetitionRecord, 'scoring_format'>
    categoryCount: number
    routes: Pick<CompetitionRouteRecord, 'points' | 'hold_count' | 'voided'>[]
}

export function setupChecklist({
    competition,
    categoryCount,
    routes,
}: SetupState): { step: SetupStep; done: boolean }[] {
    const activeRoutes = routes.filter((route) => !route.voided)
    const checklist: { step: SetupStep; done: boolean }[] = [
        { step: 'details', done: true },
        { step: 'categories', done: categoryCount > 0 },
        { step: 'routes', done: activeRoutes.length > 0 },
    ]
    if (['fixed', 'route_points'].includes(competition.scoring_format)) {
        checklist.push({
            step: 'points',
            done:
                activeRoutes.length > 0 &&
                activeRoutes.every((route) => (route.points ?? 0) > 0),
        })
    }
    if (competition.scoring_format === 'lead_height') {
        checklist.push({
            step: 'holds',
            done:
                activeRoutes.length > 0 &&
                activeRoutes.every((route) => (route.hold_count ?? 0) > 0),
        })
    }
    return checklist
}

export type LifecycleAction =
    'open' | 'close' | 'publish' | 'reopen' | 'unpublish' | 'backToDraft'

export function lifecycleActions(status: CompetitionStatus): {
    primary: LifecycleAction | null
    secondary: LifecycleAction[]
} {
    switch (status) {
        case 'draft':
            return { primary: 'open', secondary: [] }
        case 'open':
            return { primary: 'close', secondary: ['backToDraft'] }
        case 'closed':
            return { primary: 'publish', secondary: ['reopen'] }
        case 'published':
            return { primary: null, secondary: ['unpublish'] }
    }
}

export const LIFECYCLE_TARGET: Record<LifecycleAction, CompetitionStatus> = {
    open: 'open',
    close: 'closed',
    publish: 'published',
    reopen: 'open',
    unpublish: 'closed',
    backToDraft: 'draft',
}

export function categoriesFor<
    T extends Pick<
        CompetitionCategoryRecord,
        'min_birth_year' | 'max_birth_year'
    >,
>(categories: T[], birthYear: number | null | undefined): T[] {
    if (!birthYear) return categories
    return categories.filter(
        (category) =>
            (!category.min_birth_year ||
                birthYear >= category.min_birth_year) &&
            (!category.max_birth_year || birthYear <= category.max_birth_year),
    )
}

export const GUARDIAN_CONSENT_AGE = 16

export function needsGuardianConsent(
    birthYear: number | null | undefined,
    now: Date,
): boolean {
    return !!birthYear && now.getFullYear() - birthYear < GUARDIAN_CONSENT_AGE
}

export function competitionShareUrl(
    origin: string,
    gymSlug: string,
    competitionId: string,
) {
    return `${origin}/${gymSlug}/competitions/${competitionId}`
}

export function formatCompetitionWindow(
    competition: Pick<CompetitionRecord, 'starts_at' | 'ends_at'>,
    locale: string,
): string {
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
        .formatRange(
            new Date(competition.starts_at.replace(' ', 'T')),
            new Date(competition.ends_at.replace(' ', 'T')),
        )
        .replace(/\s/g, ' ')
}

export function suggestedEnd(startsAt: string, endsAt: string): string {
    if (!startsAt || (endsAt && endsAt > startsAt)) return endsAt
    const start = new Date(startsAt)
    start.setHours(start.getHours() + 3)
    return toDateTimeInput(start.toISOString())
}

export type RuleSection = 'flow' | 'scoring' | 'ranking' | 'fairPlay'

export interface RuleLine {
    key: string
    icon: string
    params?: Record<string, string | number>
}

const percent = (factor: number) => Math.round(factor * 100)

export function competitionRules(
    competition: Pick<
        CompetitionRecord,
        | 'discipline'
        | 'scoring_format'
        | 'scoring'
        | 'live_ranking'
        | 'freeze_minutes'
        | 'requires_payment'
    >,
): { section: RuleSection; lines: RuleLine[] }[] {
    const settings = scoringSettingsOf(competition)
    const format = competition.scoring_format
    const discipline = competition.discipline
    const judged = JUDGE_ONLY_FORMATS.includes(format)
    const usesStyle = discipline === 'rope' && !judged
    const factors = settings.attemptFactors ?? DEFAULT_ATTEMPT_FACTORS

    const flow: RuleLine[] = [
        { key: 'signUp', icon: 'i-lucide-user-plus' },
        ...(competition.requires_payment
            ? [{ key: 'entryFee', icon: 'i-lucide-wallet' }]
            : []),
        judged
            ? { key: 'judged', icon: 'i-lucide-clipboard-pen' }
            : { key: 'selfScore', icon: 'i-lucide-smartphone' },
        ...(usesStyle ? [{ key: 'ropeStyle', icon: 'i-lucide-cable' }] : []),
        ...(competition.live_ranking
            ? [{ key: 'live', icon: 'i-lucide-radio' }]
            : [{ key: 'noLive', icon: 'i-lucide-eye-off' }]),
        ...(competition.live_ranking && competition.freeze_minutes
            ? [
                  {
                      key: 'freeze',
                      icon: 'i-lucide-snowflake',
                      params: { n: competition.freeze_minutes },
                  },
              ]
            : []),
    ]

    const scoring: RuleLine[] = []
    if (format === 'dynamic') {
        scoring.push({
            key: `${discipline}.dynamicTop`,
            icon: 'i-lucide-pie-chart',
            params: { pool: settings.topPool ?? DEFAULT_TOP_POOL },
        })
        if (settings.zonePool && discipline === 'boulder') {
            scoring.push({
                key: 'dynamicZone',
                icon: 'i-lucide-target',
                params: { pool: settings.zonePool },
            })
        }
    }
    if (format === 'fixed' || format === 'route_points') {
        scoring.push(
            { key: `${discipline}.fixedPoints`, icon: 'i-lucide-hash' },
            {
                key: 'attemptFactors',
                icon: 'i-lucide-repeat',
                params: {
                    first: percent(factors[0] ?? 1),
                    second: percent(factors[1] ?? factors[0] ?? 1),
                    rest: percent(factors.at(-1) ?? 1),
                },
            },
        )
    }
    if (format === 'ifsc') {
        scoring.push(
            {
                key: 'ifscPoints',
                icon: 'i-lucide-hash',
                params: { top: IFSC_TOP_POINTS, zone: IFSC_ZONE_POINTS },
            },
            {
                key: 'ifscPenalty',
                icon: 'i-lucide-repeat',
                params: { penalty: IFSC_ATTEMPT_PENALTY },
            },
        )
    }
    if (format === 'tops') {
        scoring.push({ key: 'topsCount', icon: 'i-lucide-flag' })
    }
    if (format === 'lead_height') {
        scoring.push(
            { key: 'leadHeight', icon: 'i-lucide-arrow-up-to-line' },
            { key: 'leadOverall', icon: 'i-lucide-sigma' },
        )
    }
    if (usesStyle) {
        scoring.push({
            key: 'toprope',
            icon: 'i-lucide-arrow-down-to-line',
            params: {
                percent: percent(
                    settings.topropeFactor ?? DEFAULT_TOPROPE_FACTOR,
                ),
            },
        })
    }
    if (
        settings.flashBonus &&
        ['dynamic', 'fixed', 'route_points'].includes(format)
    ) {
        scoring.push({
            key: 'flashBonus',
            icon: 'i-lucide-zap',
            params: { percent: settings.flashBonus },
        })
    }
    if (settings.bestOf && format !== 'tops' && format !== 'lead_height') {
        scoring.push({
            key: `${discipline}.bestOf`,
            icon: 'i-lucide-list-ordered',
            params: { n: settings.bestOf },
        })
    }

    const ranking: RuleLine[] = [
        { key: 'perCategory', icon: 'i-lucide-tags' },
        format === 'lead_height'
            ? { key: 'tieBreakLead', icon: 'i-lucide-equal' }
            : format === 'tops'
              ? { key: 'tieBreakTops', icon: 'i-lucide-equal' }
              : { key: 'tieBreakPoints', icon: 'i-lucide-equal' },
    ]

    const fairPlay: RuleLine[] = [
        ...(judged ? [] : [{ key: 'honest', icon: 'i-lucide-handshake' }]),
        { key: 'corrections', icon: 'i-lucide-shield-check' },
        { key: `${discipline}.removed`, icon: 'i-lucide-circle-slash' },
    ]

    return [
        { section: 'flow', lines: flow },
        { section: 'scoring', lines: scoring },
        { section: 'ranking', lines: ranking },
        { section: 'fairPlay', lines: fairPlay },
    ]
}

export function defaultDisplayName(
    user:
        | {
              firstname?: string | null
              name?: string | null
              username?: string | null
          }
        | null
        | undefined,
): string {
    const fullName = [user?.firstname, user?.name]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' ')
    return fullName || user?.username || ''
}

export function resultsChangedAt(
    current: number,
    change: { kind: string; at: number },
): number {
    return change.kind === 'resync' ? current : Math.max(current, change.at)
}
