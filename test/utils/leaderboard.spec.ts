import { describe, expect, it } from 'vitest'
import type { SeasonRecord } from '~/types/models'
import {
    ROLLING_SEASON,
    defaultSeason,
    gradePyramid,
    keepSelectableSeason,
    leaderboardPath,
    seasonState,
    selectableSeasons,
} from '~/utils/leaderboard'

const season = (id: string, starts: string, ends: string): SeasonRecord => ({
    id,
    gym: 'g',
    name: id,
    starts_at: `${starts} 00:00:00.000Z`,
    ends_at: `${ends} 00:00:00.000Z`,
})

const spring = season('spring', '2026-03-01', '2026-05-31')
const autumn = season('autumn', '2026-09-01', '2026-11-30')
const winter = season('winter', '2026-12-01', '2027-02-28')

describe('seasonState', () => {
    it('includes the first and last day', () => {
        expect(seasonState(autumn, '2026-08-31')).toBe('upcoming')
        expect(seasonState(autumn, '2026-09-01')).toBe('running')
        expect(seasonState(autumn, '2026-11-30')).toBe('running')
        expect(seasonState(autumn, '2026-12-01')).toBe('over')
    })
})

describe('defaultSeason', () => {
    it('opens the running season, else the last 60 days', () => {
        expect(defaultSeason([spring, autumn], '2026-10-04')).toBe('autumn')
        expect(defaultSeason([spring], '2026-10-04')).toBe(ROLLING_SEASON)
    })
})

describe('selectableSeasons', () => {
    it('lists started seasons, newest first', () => {
        expect(
            selectableSeasons([spring, winter, autumn], '2026-10-04').map(
                (entry) => entry.id,
            ),
        ).toEqual(['autumn', 'spring'])
    })
})

describe('leaderboardPath', () => {
    it('only sends a season when one is picked', () => {
        expect(leaderboardPath('g 1', 'boulder', ROLLING_SEASON)).toBe(
            '/api/gyms/g%201/leaderboard?kind=boulder',
        )
        expect(leaderboardPath('g', 'route', 'autumn')).toBe(
            '/api/gyms/g/leaderboard?kind=route&season=autumn',
        )
    })
})

describe('gradePyramid', () => {
    it('puts the hardest grade on top and splits flashes from tops', () => {
        expect(
            gradePyramid([
                { grade: '6A', sends: 3, flashes: 1 },
                { grade: '7A', sends: 1, flashes: 1 },
            ]),
        ).toEqual([
            { grade: '7A', flash: 1, top: 0 },
            { grade: '6A', flash: 1, top: 2 },
        ])
    })
})

describe('keepSelectableSeason', () => {
    const today = '2026-10-05'

    it('keeps rolling and existing seasons', () => {
        expect(keepSelectableSeason([autumn], ROLLING_SEASON, today)).toBe(
            ROLLING_SEASON,
        )
        expect(keepSelectableSeason([spring, autumn], 'spring', today)).toBe(
            'spring',
        )
    })

    it('falls back to the running season once the selected one is gone', () => {
        expect(keepSelectableSeason([autumn], 'spring', today)).toBe('autumn')
        expect(keepSelectableSeason([], 'autumn', today)).toBe(ROLLING_SEASON)
        expect(keepSelectableSeason([autumn, winter], 'winter', today)).toBe(
            'autumn',
        )
    })
})
