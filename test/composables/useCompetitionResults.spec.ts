import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref as vueRef } from 'vue'

const getCompetitionStandings = vi.fn().mockResolvedValue({ categories: [] })
vi.mock('~/api/competitions', () => ({ getCompetitionStandings }))

let onChange: (change: { kind: string }) => void = () => {}
vi.stubGlobal(
    'useCompetitionLive',
    (_id: unknown, handler: typeof onChange) => (onChange = handler),
)

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    getCompetitionStandings.mockClear()
})

describe('useCompetitionResults', () => {
    it('loads the public view unless staff asks for live standings', async () => {
        const { useCompetitionResults } =
            await import('~/composables/useCompetitionResults')
        useCompetitionResults(vueRef('c1'))
        useCompetitionResults(vueRef('c1'), { staff: true })

        expect(getCompetitionStandings).toHaveBeenCalledWith('c1', {
            view: 'public',
        })
        expect(getCompetitionStandings).toHaveBeenCalledWith('c1', {})
    })

    it('refetches once 2–4 s after live changes, after the shared cache expired', async () => {
        vi.useFakeTimers()
        vi.spyOn(Math, 'random').mockReturnValue(0.75)
        const { useCompetitionResults } =
            await import('~/composables/useCompetitionResults')
        useCompetitionResults(vueRef('c1'))
        getCompetitionStandings.mockClear()

        onChange({ kind: 'scores' })
        onChange({ kind: 'entries' })
        onChange({ kind: 'categories' })
        vi.advanceTimersByTime(3_499)
        expect(getCompetitionStandings).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(getCompetitionStandings).toHaveBeenCalledTimes(1)
    })

    it('ignores changes that leave the standings alone', async () => {
        vi.useFakeTimers()
        const { useCompetitionResults } =
            await import('~/composables/useCompetitionResults')
        useCompetitionResults(vueRef('c1'))
        getCompetitionStandings.mockClear()

        onChange({ kind: 'categories' })
        vi.advanceTimersByTime(2_000)
        expect(getCompetitionStandings).not.toHaveBeenCalled()
    })
})
