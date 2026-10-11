import { describe, expect, it } from 'vitest'
import fixture from '../../backend/testdata/competitionStandings.json'
import {
    DEFAULT_ATTEMPT_FACTORS,
    DEFAULT_TOP_POOL,
    DEFAULT_TOPROPE_FACTOR,
    IFSC_ATTEMPT_PENALTY,
    IFSC_TOP_POINTS,
    IFSC_ZONE_POINTS,
    SCORING_FORMATS,
} from '#shared/utils/competitionScoring'
import type { CategoryStanding } from '#shared/utils/competitionResults'

describe('competition standings fixture', () => {
    it('scores with the defaults the rules dialog explains', () => {
        expect(fixture.defaults).toEqual({
            topPool: DEFAULT_TOP_POOL,
            attemptFactors: DEFAULT_ATTEMPT_FACTORS,
            topropeFactor: DEFAULT_TOPROPE_FACTOR,
            ifscTopPoints: IFSC_TOP_POINTS,
            ifscZonePoints: IFSC_ZONE_POINTS,
            ifscAttemptPenalty: IFSC_ATTEMPT_PENALTY,
        })
    })

    it('covers every scoring format', () => {
        const formats = new Set(
            fixture.cases.map((c) => c.input.competition.scoring_format),
        )
        expect([...formats].sort()).toEqual([...SCORING_FORMATS].sort())
    })

    it.each(fixture.cases)(
        'ranks every entry of $name in its category',
        ({ input, standings }) => {
            const categories = standings as CategoryStanding[]
            expect(categories.map(({ id }) => id)).toEqual(
                input.categories.map(({ id }) => id),
            )
            for (const category of categories) {
                const entries = input.entries
                    .filter((entry) => entry.category === category.id)
                    .map(({ id }) => id)
                expect(category.rows.map(({ entry }) => entry).sort()).toEqual(
                    entries.sort(),
                )
                const ranks = category.rows.map(({ rank }) => rank)
                expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
            }
        },
    )
})
