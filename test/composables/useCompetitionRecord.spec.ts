import { describe, expect, it, vi } from 'vitest'
import { ref as vueRef } from 'vue'

const getCompetition = vi.fn()
vi.mock('~/api/competitions', () => ({ getCompetition }))

let onChange: (change: { kind: string }) => void = () => {}
vi.stubGlobal('useRoute', () => ({ params: { id: 'c1' } }))
vi.stubGlobal('useCurrentGymId', () => vueRef('g1'))
vi.stubGlobal(
    'useCompetitionLive',
    (_id: unknown, handler: typeof onChange) => (onChange = handler),
)
vi.stubGlobal('createError', (input: object) =>
    Object.assign(new Error('fatal'), input),
)

function asyncData(value: unknown) {
    const result = {
        data: vueRef(value),
        refresh: vi.fn().mockResolvedValue(undefined),
    }
    const promise = Object.assign(Promise.resolve(result), result)
    return Object.defineProperty(promise, 'then', {
        enumerable: true,
        value: promise.then.bind(promise),
    })
}

describe('useCompetitionRecord', () => {
    it('loads under one key per competition and 404s for another gym', async () => {
        const useAsyncData = vi.fn(() => asyncData({ id: 'c1', gym: 'g2' }))
        vi.stubGlobal('useAsyncData', useAsyncData)
        const { useCompetitionRecord } =
            await import('~/composables/useCompetitionRecord')

        await expect(useCompetitionRecord()).rejects.toMatchObject({
            status: 404,
        })
        const [key] = useAsyncData.mock.calls[0] as unknown as [() => string]
        expect(key()).toBe('competition:c1')
    })

    it('refreshes on competition changes and forwards every change', async () => {
        vi.useFakeTimers()
        const request = asyncData({ id: 'c1', gym: 'g1' })
        vi.stubGlobal('useAsyncData', () => request)
        const { useCompetitionRecord } =
            await import('~/composables/useCompetitionRecord')
        const seen: string[] = []
        const { data, competitionId } = await useCompetitionRecord((change) =>
            seen.push(change.kind),
        )
        expect(data.value).toEqual({ id: 'c1', gym: 'g1' })
        expect(competitionId.value).toBe('c1')

        onChange({ kind: 'entries' })
        vi.advanceTimersByTime(1000)
        expect(request.refresh).not.toHaveBeenCalled()
        onChange({ kind: 'competition' })
        vi.advanceTimersByTime(1000)
        expect(request.refresh).toHaveBeenCalledTimes(1)
        expect(seen).toEqual(['entries', 'competition'])
        vi.useRealTimers()
    })
})
