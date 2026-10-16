import { describe, expect, it, vi } from 'vitest'

let inContext = false
const runWithContext = vi.fn(<T>(fn: () => T) => {
    inContext = true
    try {
        return fn()
    } finally {
        inContext = false
    }
})
vi.stubGlobal('useNuxtApp', () => ({ runWithContext }))

const listSeasons = vi.fn().mockResolvedValue([])
const getLeaderboard = vi.fn(async () => {
    if (!inContext) throw new Error('outside the Nuxt context')
    return { rows: [{ user: 'a' }, { user: 'b' }, { user: 'c' }] }
})
vi.mock('~/api/ticks', () => ({ listSeasons, getLeaderboard }))

describe('loadTvBoards', () => {
    it('loads every board inside the Nuxt context after awaiting the seasons', async () => {
        const { loadTvBoards } = await import('~/composables/loadTvBoards')
        const { season, boards } = await loadTvBoards('g1', 2)

        expect(season).toBeNull()
        expect(boards.length).toBeGreaterThan(0)
        expect(boards.every((board) => board.rows.length === 2)).toBe(true)
        expect(getLeaderboard).toHaveBeenCalledWith(
            'g1',
            expect.objectContaining({ kind: boards[0]!.kind }),
        )
    })
})
