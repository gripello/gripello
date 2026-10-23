import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { defaultMapLocation } from '~/composables/useGymMapLocation'

const plan = {
    width: 20,
    height: 10,
    shapes: [
        {
            kind: 'floor',
            points: [
                [0, 0],
                [5, 0],
                [5, 5],
                [0, 5],
            ],
        },
    ],
}

describe('defaultMapLocation', () => {
    it('prefers the first location with a floor plan', () => {
        expect(
            defaultMapLocation([
                { id: 'empty', map: { width: 20, height: 10, shapes: [] } },
                { id: 'none' },
                { id: 'hall', map: plan },
            ]),
        ).toBe('hall')
    })

    it('falls back to the first location', () => {
        expect(defaultMapLocation([{ id: 'a' }, { id: 'b' }])).toBe('a')
        expect(defaultMapLocation([])).toBe('')
    })
})

async function mapLocation(locations: unknown[], error: Error) {
    vi.stubGlobal('useNuxtApp', () => ({
        runWithContext: (fn: () => unknown) => fn(),
    }))
    vi.stubGlobal('useCurrentGymId', () => ref('gym'))
    vi.stubGlobal('useRoute', () => ({ query: {} }))
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }))
    vi.stubGlobal('useLocations', () =>
        Object.assign(Promise.resolve(), {
            data: ref(locations),
            error: ref(error),
            refresh: vi.fn(),
        }),
    )
    vi.stubGlobal('useLiveLocation', vi.fn())
    vi.doMock('~/composables/useOfflineData', () => ({
        useOfflineData: () =>
            Object.assign(Promise.resolve(), {
                data: ref([]),
                error: ref(null),
                refresh: vi.fn(),
            }),
    }))
    const { useGymMapLocation } =
        await import('~/composables/useGymMapLocation')
    return useGymMapLocation('map')
}

describe('useGymMapLocation', () => {
    it('reports a failed location load, so the map shows the error instead of "no map"', async () => {
        const failed = new Error('offline')

        const state = await mapLocation([], failed)

        expect(state.locationsError.value).toBe(failed)
    })
})
