import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref, watch } from 'vue'

const authRecord = ref<{ id: string } | null>(null)
vi.stubGlobal('useAuthRecord', () => authRecord)
vi.stubGlobal(
    'useAsyncData',
    (
        _key: string,
        handler: () => Promise<unknown>,
        options: { default: () => unknown; watch: unknown[] },
    ) => {
        const data = ref(options.default())
        const refresh = async () => {
            data.value = await handler()
        }
        watch(options.watch as never, refresh)
        void refresh()
        return { data, error: ref(null), refresh }
    },
)
const getFullList = vi
    .fn()
    .mockResolvedValue([
        { id: 'f1', follower: 'u2', followee: 'u1', status: 'pending' },
    ])
vi.stubGlobal('usePocketbase', () => ({
    collection: () => ({ getFullList }),
}))

describe('useFollows', () => {
    it('loads the follow requests once the climber signs in', async () => {
        const { useFollows } = await import('~/composables/useFollows')
        const { requests } = useFollows()
        await nextTick()
        expect(requests.value).toEqual([])
        expect(getFullList).not.toHaveBeenCalled()

        authRecord.value = { id: 'u1' }
        await vi.waitFor(() => expect(requests.value).toHaveLength(1))
    })
})
