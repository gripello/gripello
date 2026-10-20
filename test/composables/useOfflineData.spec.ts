import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOfflineData } from '~/composables/useOfflineData'

const offline = Object.assign(new Error('Failed to fetch'), { status: 0 })
const store = (key: string, value: unknown) => ({
    _asyncData: { [key]: { data: { value }, error: { value: undefined } } },
    payload: { data: { [key]: value } },
})

let handler: (nuxtApp: unknown, ctx: unknown) => Promise<unknown>
const useAsyncData = vi.fn(
    (_key: unknown, fn: typeof handler, _options: unknown) => {
        handler = fn
        return {}
    },
)

afterEach(() => vi.unstubAllGlobals())

describe('useOfflineData', () => {
    it('keeps the data loaded under the current key when the network is gone', async () => {
        vi.stubGlobal('useAsyncData', useAsyncData)
        let id = 'a'
        const fetch = vi.fn().mockRejectedValue(offline)
        useOfflineData(() => `item:${id}`, fetch, { default: () => null })

        expect(useAsyncData).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function),
            { default: expect.any(Function) },
        )
        await expect(handler(store('item:a', 'A'), {})).resolves.toBe('A')
        id = 'b'
        await expect(handler(store('item:a', 'A'), {})).rejects.toBe(offline)
    })

    it('drops loaded data that no longer fits', async () => {
        vi.stubGlobal('useAsyncData', useAsyncData)
        useOfflineData('rows', () => Promise.reject(offline), {
            fits: (rows: string[]) => rows.includes('x'),
        })
        await expect(handler(store('rows', ['y']), {})).rejects.toBe(offline)
        await expect(handler(store('rows', ['x']), {})).resolves.toEqual(['x'])
    })
})
