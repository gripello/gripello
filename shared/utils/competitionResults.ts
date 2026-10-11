import type { ScoringFormat } from './competitionScoring'

export type ResultsVisibility = 'live' | 'frozen' | 'final' | 'hidden'

export interface StandingRow {
    entry: string
    rank: number
    bib: number
    name: string
    points: number
    tops: number
    zones: number
    rankPoints?: number
}

export interface CategoryStanding {
    id: string
    name: string
    rows: StandingRow[]
}

export interface CompetitionResults {
    visibility: ResultsVisibility
    format: ScoringFormat
    updated: string
    categories: CategoryStanding[]
}
