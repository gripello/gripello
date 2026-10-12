import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompetitionRouteRecord } from '~/types/models'

vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))

const listScores = vi.fn()
const putScores = vi.fn()
vi.mock('~/api/competitions', () => ({
    listScores: (...args: unknown[]) => listScores(...args),
    putScores: (...args: unknown[]) => putScores(...args),
}))

const boulder = { id: 'cr1', zone: true } as CompetitionRouteRecord

describe('useScorecard', () => {
    beforeEach(() => {
        localStorage.clear()
        listScores.mockReset()
        putScores.mockReset().mockResolvedValue([])
    })

    it('keeps a saved click when an older reload answers after it', async () => {
        const { useScorecard } = await import('~/composables/useScorecard')
        const card = useScorecard(ref('c1'), ref('e1'))
        let answerReload!: (records: unknown[]) => void
        listScores.mockReturnValueOnce(
            new Promise((resolve) => (answerReload = resolve)),
        )
        const loading = card.load()
        card.act(boulder, { type: 'attempt' })
        await vi.waitFor(() => expect(card.pendingCount.value).toBe(0))
        answerReload([])
        await loading
        expect(card.scores.value.cr1?.attempts).toBe(1)
    })
})
