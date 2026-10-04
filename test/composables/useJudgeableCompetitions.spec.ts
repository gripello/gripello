import { describe, expect, it, vi } from 'vitest'
import { ref as vueRef } from 'vue'
import { gymFilter } from '~/composables/useGym'

const getFullList = vi.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
vi.stubGlobal('usePocketbase', () => ({
    filter: (raw: string, params: Record<string, string>) =>
        raw.replace('{:gym}', `"${params.gym}"`),
    collection: () => ({ getFullList }),
}))
vi.stubGlobal('useCurrentGymId', () => vueRef('g1'))
vi.stubGlobal('gymFilter', gymFilter)

describe('useJudgeableCompetitions', () => {
    it('lists every open or closed competition of the gym by start date', async () => {
        const { useJudgeableCompetitions } =
            await import('~/composables/useJudgeableCompetitions')
        const { data } = useJudgeableCompetitions()

        await vi.waitFor(() => expect(data.value).toHaveLength(2))
        expect(getFullList).toHaveBeenCalledWith({
            filter: 'gym = "g1" && (status = "open" || status = "closed")',
            sort: 'starts_at',
        })
    })
})
