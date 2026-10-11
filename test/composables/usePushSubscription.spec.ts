import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed as vueComputed, ref as vueRef } from 'vue'
import { routeApi } from '../api/apiMock'

vi.stubGlobal('ref', vueRef)
vi.stubGlobal('computed', vueComputed)
vi.stubGlobal('onMounted', () => {})
vi.stubGlobal('useRealtime', vi.fn())
vi.stubGlobal('useAuthStore', () => ({ record: { id: 'u1' } }))

const SETTINGS = {
    enabled: true,
    publicKey: 'key',
    topics: [{ key: 'new_routes' }],
}

describe('usePushSubscription', () => {
    let devices: () => Promise<unknown>
    let api: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.resetModules()
        devices = async () => ({ items: [{ id: 'd1', endpoint: 'e' }] })
        api = vi.fn(async (path: string) =>
            path === '/notifications/settings'
                ? SETTINGS
                : path === '/me/push-subscriptions'
                  ? devices()
                  : undefined,
        )
        routeApi(api)
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
        devices = () => Promise.reject(new Error('offline'))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const push = await load()
        await push.refresh()
        expect(push.loadError.value).toBe(true)
        expect(push.topics.value).toEqual([])

        devices = async () => ({ items: [] })
        await push.refresh()
        expect(push.loadError.value).toBe(false)
    })

    it('sends the test push to this device only', async () => {
        const push = await load()
        push.currentEndpoint.value = 'https://fcm.googleapis.com/fcm/send/abc'

        await push.sendTest()

        expect(api).toHaveBeenCalledWith('/me/push/test', {
            method: 'POST',
            body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' },
        })
    })
})
