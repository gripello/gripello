import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed as vueComputed, ref as vueRef } from 'vue'

vi.stubGlobal('ref', vueRef)
vi.stubGlobal('computed', vueComputed)
vi.stubGlobal('onMounted', () => {})
vi.stubGlobal('usePbSubscription', () => ({ subscribe: vi.fn() }))

let pbMock: any
vi.stubGlobal('usePocketbase', () => pbMock)

describe('usePushSubscription', () => {
    let getFullList: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.resetModules()
        getFullList = vi.fn().mockResolvedValue([{ id: 'd1', endpoint: 'e' }])
        pbMock = {
            send: vi.fn().mockResolvedValue({
                pushKey: 'key',
                topics: [{ key: 'new_routes' }],
            }),
            collection: vi.fn().mockReturnValue({ getFullList }),
        }
    })

    async function load() {
        const mod = await import('~/composables/usePushSubscription')
        return mod.usePushSubscription()
    }

    it('loads topics and devices', async () => {
        const push = await load()
        await push.refresh()
        expect(push.loadError.value).toBe(false)
        expect(push.topics.value).toEqual([{ key: 'new_routes' }])
        expect(push.devices.value).toHaveLength(1)
    })

    it('flags a load error instead of showing an empty account', async () => {
        getFullList.mockRejectedValue(new Error('offline'))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const push = await load()
        await push.refresh()
        expect(push.loadError.value).toBe(true)
        expect(push.topics.value).toEqual([])

        getFullList.mockResolvedValue([])
        await push.refresh()
        expect(push.loadError.value).toBe(false)
    })
})
