import type { SeasonRecord } from '~/types/models'
import type { LogbookKind, PyramidRow } from '#shared/utils/logbook'

export const ROLLING_SEASON = 'rolling'
export const LEADERBOARD_KINDS: LogbookKind[] = ['boulder', 'route']

export interface LeaderboardRow {
    rank: number
    user: string
    name: string
    avatar: string
    score: number
    sends: number
    flashes: number
    hardest: string
}

export interface LeaderboardRoute {
    id: string
    name: string
    color: string
    grade: string
    sends: number
    flashes: number
    points?: number
}

export interface LeaderboardGrade {
    grade: string
    sends: number
    flashes: number
}

export interface Leaderboard {
    from: string
    to: string
    total: number
    rows: LeaderboardRow[]
    me: LeaderboardRow | null
    ahead: number | null
    mySends: LeaderboardRoute[]
    stats: { climbers: number; sends: number; flashes: number; hardest: string }
    grades: LeaderboardGrade[]
    topRoutes: LeaderboardRoute[]
}

export function gradePyramid(grades: LeaderboardGrade[]): PyramidRow[] {
    return [...grades].reverse().map(({ grade, sends, flashes }) => ({
        grade,
        flash: flashes,
        top: sends - flashes,
    }))
}

const seasonDay = (value: string) => value.slice(0, 10)

export function seasonState(
    season: Pick<SeasonRecord, 'starts_at' | 'ends_at'>,
    today: string,
): 'upcoming' | 'running' | 'over' {
    if (today < seasonDay(season.starts_at)) return 'upcoming'
    if (today > seasonDay(season.ends_at)) return 'over'
    return 'running'
}

export function defaultSeason(seasons: SeasonRecord[], today: string): string {
    return (
        seasons.find((season) => seasonState(season, today) === 'running')
            ?.id ?? ROLLING_SEASON
    )
}

export function selectableSeasons(
    seasons: SeasonRecord[],
    today: string,
): SeasonRecord[] {
    return seasons
        .filter((season) => seasonState(season, today) !== 'upcoming')
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
}

export function keepSelectableSeason(
    seasons: SeasonRecord[],
    selected: string,
    today: string,
): string {
    return selected === ROLLING_SEASON ||
        selectableSeasons(seasons, today).some(({ id }) => id === selected)
        ? selected
        : defaultSeason(seasons, today)
}

export function leaderboardPath(
    gymId: string,
    kind: LogbookKind,
    season: string,
): string {
    const query = new URLSearchParams({ kind })
    if (season !== ROLLING_SEASON) query.set('season', season)
    return `/api/gyms/${encodeURIComponent(gymId)}/leaderboard?${query}`
}
