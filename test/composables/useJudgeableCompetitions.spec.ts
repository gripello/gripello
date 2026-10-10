import { describe, expect, it, vi } from 'vitest'
import { ref as vueRef } from 'vue'

const listCompetitions = vi.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
vi.mock('~/api/competitions', () => ({ listCompetitions }))
vi.stubGlobal('useCurrentGymId', () => vueRef('g1'))

describe('useJudgeableCompetitions', () => {
    it('lists every open or closed competition of the gym', async () => {
        const { useJudgeableCompetitions } =
            await import('~/composables/useJudgeableCompetitions')
        const { data } = useJudgeableCompetitions()

        await vi.waitFor(() => expect(data.value).toHaveLength(2))
        expect(listCompetitions).toHaveBeenCalledWith('g1', {
            status: ['open', 'closed'],
        })
    })
})
