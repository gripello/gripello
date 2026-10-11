import { describe, expect, it, vi } from 'vitest'
import {
    cachedResultsUsable,
    loadResults,
    MIN_RECOMPUTE_MS,
    PUBLIC_RESULTS_CACHE_MS,
} from '../../server/utils/competitionResults'

describe('cachedResultsUsable', () => {
    it('serves the cache while it is fresh', () => {
        expect(cachedResultsUsable(1_000, 2_000, 0)).toBe(true)
        expect(
            cachedResultsUsable(1_000, 1_000 + PUBLIC_RESULTS_CACHE_MS, 0),
        ).toBe(false)
    })

    it('recomputes when a change happened after the cache was built', () => {
        expect(cachedResultsUsable(1_000, 2_500, 1_500)).toBe(false)
        expect(cachedResultsUsable(1_000, 2_500, 900)).toBe(true)
    })

    it('recomputes at most once per second however often changes arrive', () => {
        expect(
            cachedResultsUsable(1_000, 1_000 + MIN_RECOMPUTE_MS - 1, 1_500),
        ).toBe(true)
    })

    it('ignores change times from the future', () => {
        expect(cachedResultsUsable(1_000, 2_500, 99_000)).toBe(true)
    })
})

describe('loadResults', () => {
    const input = {
        competition: { scoring_format: 'tops_zones' },
        categories: [],
        entries: [],
        routes: [],
        scores: [],
    }

    it('reads the results input of the Go API and builds the standings', async () => {
        const api = vi.fn().mockResolvedValue({ ...input, visibility: 'live' })
        const results = await loadResults(api as never, 'c1')
        expect(api).toHaveBeenCalledWith('/competitions/c1/results')
        expect(results).toMatchObject({
            visibility: 'live',
            format: 'tops_zones',
            categories: [],
        })
    })

    it('returns no categories while results are hidden', async () => {
        const api = vi.fn().mockResolvedValue({
            ...input,
            categories: [{ id: 'x', name: 'X' }],
            visibility: 'hidden',
        })
        expect((await loadResults(api as never, 'c1')).categories).toEqual([])
    })
})
