export const COMPETITION_DISCIPLINES = ['boulder', 'rope'] as const
export type CompetitionDiscipline = (typeof COMPETITION_DISCIPLINES)[number]

export const SCORING_FORMATS = [
    'dynamic',
    'fixed',
    'ifsc',
    'tops',
    'route_points',
    'lead_height',
] as const
export type ScoringFormat = (typeof SCORING_FORMATS)[number]

export const FORMATS_BY_DISCIPLINE: Record<
    CompetitionDiscipline,
    ScoringFormat[]
> = {
    boulder: ['dynamic', 'fixed', 'ifsc', 'tops'],
    rope: ['route_points', 'lead_height', 'dynamic'],
}

export const JUDGE_ONLY_FORMATS: readonly ScoringFormat[] = ['lead_height']

export type ClimbStyle = 'lead' | 'toprope'

export interface ScoringSettings {
    format: ScoringFormat
    topPool?: number
    zonePool?: number
    attemptFactors?: number[]
    bestOf?: number | null
    flashBonus?: number
    topropeFactor?: number
}

export const DEFAULT_TOP_POOL = 1000
export const DEFAULT_ATTEMPT_FACTORS = [1, 0.9, 0.8]
export const DEFAULT_TOPROPE_FACTOR = 0.5
export const IFSC_TOP_POINTS = 25
export const IFSC_ZONE_POINTS = 10
export const IFSC_ATTEMPT_PENALTY = 0.1
