import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed as vueComputed, ref as vueRef } from 'vue'
import { PUSH_DECLINED_KEY } from '~/utils/push'

vi.stubGlobal('ref', vueRef)
vi.stubGlobal('computed', vueComputed)

let mounted: () => void
vi.stubGlobal('onMounted', (fn: () => void) => {
    mounted = fn
})

let pbMock: any
vi.stubGlobal('usePocketbase', () => pbMock)

describe('usePushOffer', () => {
    let send: ReturnType<typeof vi.fn>
    let getList: ReturnType<typeof vi.fn>
    let browserSubscription: { endpoint: string } | null

    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
        browserSubscription = null
        send = vi.fn().mockResolvedValue({ pushKey: 'key' })
        getList = vi.fn().mockResolvedValue({ items: [{ id: 'phone' }] })
        pbMock = {
            authStore: { isValid: true, record: { id: 'u1' } },
            send,
            collection: vi.fn().mockReturnValue({ getList }),
        }
        vi.stubGlobal('PushManager', class {})
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                getRegistration: async () => ({
                    pushManager: {
                        getSubscription: async () => browserSubscription,
                    },
                }),
            },
        })
    })

    async function offerWith(permission: NotificationPermission) {
        vi.stubGlobal('Notification', { permission })
        const { usePushOffer } = await import('~/composables/usePushOffer')
        const { offered } = usePushOffer()
        mounted()
        await new Promise((resolve) => setTimeout(resolve))
        return offered.value
    }

    it('only loads the key before the browser has asked', async () => {
        expect(await offerWith('default')).toBe(true)
        expect(send).toHaveBeenCalledOnce()
        expect(getList).not.toHaveBeenCalled()
    })

    it('offers again after signing back in when the account uses push', async () => {
        expect(await offerWith('granted')).toBe(true)
        expect(getList).toHaveBeenCalledWith(1, 1, {
            fields: 'id',
            skipTotal: true,
        })
    })

    it('makes no request when this browser is subscribed', async () => {
        browserSubscription = { endpoint: 'here' }
        expect(await offerWith('granted')).toBe(false)
        expect(send).not.toHaveBeenCalled()
    })

    it('makes no request when push is blocked or was removed here', async () => {
        expect(await offerWith('denied')).toBe(false)
        localStorage.setItem(PUSH_DECLINED_KEY, '["u1"]')
        expect(await offerWith('granted')).toBe(false)
        expect(send).not.toHaveBeenCalled()
    })
})
