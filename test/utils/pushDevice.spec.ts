import { afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: true }))
const plugin = vi.hoisted(() => {
    const listeners: Record<string, (event: any) => void> = {}
    return {
        listeners,
        receive: 'granted',
        token: 'fcm-token',
        failure: '',
        addListener: vi.fn(async (name: string, fn: (event: any) => void) => {
            listeners[name] = fn
            return { remove: vi.fn() }
        }),
        register: vi.fn(async () => {
            if (plugin.failure)
                listeners.registrationError!({ error: plugin.failure })
            else listeners.registration!({ value: plugin.token })
        }),
        unregister: vi.fn(async () => {}),
        // Like Capacitor's plugin proxies, which answer every property; a promise must never resolve to the plugin.
        then: () => {
            throw new Error('the plugin was treated as a promise')
        },
        checkPermissions: vi.fn(async () => ({ receive: plugin.receive })),
        requestPermissions: vi.fn(async () => ({ receive: plugin.receive })),
    }
})

const settings = vi.hoisted(() => ({ native: true }))

vi.mock('~/utils/native', () => ({ isNativeApp: () => native.value }))
vi.mock('~/api/notifications', () => ({
    getNotificationSettings: async () => settings,
}))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }))

import {
    FCM_TOKEN_TIMEOUT_MS,
    nativePermission,
    pushDevice,
} from '~/utils/pushDevice'

describe('native push device', () => {
    afterEach(() => {
        plugin.receive = 'granted'
        plugin.failure = ''
        vi.clearAllMocks()
    })

    it('subscribes with the FCM token after the user allows notifications', async () => {
        expect(await pushDevice().subscribe('')).toEqual({
            kind: 'fcm',
            endpoint: 'fcm-token',
        })
    })

    it('does not register when the user declines', async () => {
        plugin.receive = 'denied'
        expect(await pushDevice().subscribe('')).toBeNull()
        expect(plugin.register).not.toHaveBeenCalled()
        expect(await pushDevice().currentEndpoint()).toBe('')
    })

    it('reports registration failures', async () => {
        plugin.failure = 'no firebase'
        await expect(pushDevice().currentEndpoint()).rejects.toThrow(
            'no firebase',
        )
    })

    it('gives up when no token arrives instead of waiting forever', async () => {
        vi.useFakeTimers()
        plugin.register.mockImplementationOnce(async () => {})
        const subscribed = pushDevice().subscribe('')
        const outcome = expect(subscribed).rejects.toThrow('No FCM token')
        await vi.advanceTimersByTimeAsync(FCM_TOKEN_TIMEOUT_MS)
        await outcome
        vi.useRealTimers()
    })

    it('stops the token timer when the plugin cannot listen', async () => {
        vi.useFakeTimers()
        plugin.addListener.mockRejectedValueOnce(new Error('no listener'))
        await expect(pushDevice().subscribe('')).rejects.toThrow('no listener')
        expect(vi.getTimerCount()).toBe(0)
        vi.useRealTimers()
    })

    it('deletes the token on unsubscribe', async () => {
        await pushDevice().unsubscribe()
        expect(plugin.unregister).toHaveBeenCalledOnce()
    })

    it('never touches the plugin when the server has no FCM', async () => {
        vi.resetModules()
        settings.native = false
        const { pushDevice: fresh } = await import('~/utils/pushDevice')
        expect(await fresh().subscribe('')).toBeNull()
        expect(await fresh().currentEndpoint()).toBe('')
        await fresh().unsubscribe()
        expect(plugin.requestPermissions).not.toHaveBeenCalled()
        expect(plugin.register).not.toHaveBeenCalled()
        expect(plugin.unregister).not.toHaveBeenCalled()
        settings.native = true
    })

    it('maps the plugin permission states to the browser ones', () => {
        expect(nativePermission('granted')).toBe('granted')
        expect(nativePermission('denied')).toBe('denied')
        expect(nativePermission('prompt-with-rationale')).toBe('default')
    })
})
