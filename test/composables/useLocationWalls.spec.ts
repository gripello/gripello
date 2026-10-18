import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useLocationWalls } from '~/composables/useLocationWalls'

const pending = new Map<string, (walls: { id: string }[]) => void>()
const listWalls = vi.fn(
    (_gym: string, { location }: { location: string }) =>
        new Promise<{ id: string }[]>((resolve) =>
            pending.set(location, resolve),
        ),
)
vi.mock('~/api/routes', () => ({
    listWalls: (gym: string, query: { location: string }) =>
        listWalls(gym, query),
}))

describe('useLocationWalls', () => {
    it('keeps the walls of the current location when an older answer arrives late', async () => {
        const location = ref('first')
        const walls = useLocationWalls(ref('g1'), () => location.value)
        location.value = 'second'
        await nextTick()

        pending.get('second')!([{ id: 'w2' }])
        await vi.waitFor(() => expect(walls.value).toEqual([{ id: 'w2' }]))
        pending.get('first')!([{ id: 'w1' }])
        await new Promise((resolve) => setTimeout(resolve))

        expect(walls.value).toEqual([{ id: 'w2' }])
        expect(listWalls).toHaveBeenCalledWith('g1', { location: 'first' })
    })

    it('has no walls without a location', async () => {
        const location = ref('first')
        const walls = useLocationWalls(ref('g1'), () => location.value)
        pending.get('first')!([{ id: 'w1' }])
        await vi.waitFor(() => expect(walls.value).toHaveLength(1))

        location.value = ''
        await vi.waitFor(() => expect(walls.value).toEqual([]))
    })
})
