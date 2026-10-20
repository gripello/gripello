import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useAppStatus } from '~/composables/useAppStatus'
import { routeApi } from '../api/apiMock'

function mountStatus() {
    const scope = effectScope()
    onTestFinished(() => scope.stop())
    return scope.run(() => useAppStatus())!
}

describe('useAppStatus', () => {
    it('asks for the online count only when signed in', () => {
        routeApi(vi.fn())
        const enabled: Record<string, (() => boolean) | undefined> = {}
        vi.stubGlobal(
            'useAsyncData',
            (
                key: string,
                _handler: unknown,
                options: { enabled?: () => boolean },
            ) => {
                enabled[key] = options.enabled
                return { data: { value: null } }
            },
        )
        const store = { isValid: false, token: '', record: null }
        globalThis.__AUTH_STORE__ = store as never
        mountStatus()
        expect(enabled['footer:health']).toBeUndefined()
        expect(enabled['footer:online']?.()).toBe(false)
        store.isValid = true
        expect(enabled['footer:online']?.()).toBe(true)
    })

    it('counts the server as healthy only when it reports ok', async () => {
        const handlers: Record<string, () => Promise<unknown>> = {}
        vi.stubGlobal('useAsyncData', (key: string, handler: () => any) => {
            handlers[key] = handler
            return { data: { value: null } }
        })
        const health = vi.fn()
        routeApi(health)
        mountStatus()

        health.mockResolvedValueOnce({ status: 'ok', database: 'ok' })
        expect(await handlers['footer:health']!()).toBe(true)
        health.mockResolvedValueOnce({ status: 'degraded' })
        expect(await handlers['footer:health']!()).toBe(false)
        health.mockRejectedValueOnce({ status: 503 })
        expect(await handlers['footer:health']!()).toBe(false)
    })

    it('shows no outage before the first check and re-checks when the device comes back online', () => {
        const health = ref<boolean | null>(null)
        const refresh = vi.fn()
        vi.stubGlobal('useAsyncData', (key: string) =>
            key === 'footer:health'
                ? { data: health, refresh }
                : { data: { value: null } },
        )
        routeApi(vi.fn())
        const { isHealthy } = mountStatus()
        expect(isHealthy.value).toBe(true)

        health.value = false
        expect(isHealthy.value).toBe(false)

        window.dispatchEvent(new Event('online'))
        expect(refresh).toHaveBeenCalledOnce()
    })

    it('re-checks on return from a hidden tab and every five minutes while visible', () => {
        vi.useFakeTimers()
        onTestFinished(() => vi.useRealTimers())
        const refresh = vi.fn()
        vi.stubGlobal('useAsyncData', (key: string) =>
            key === 'footer:health'
                ? { data: ref(true), refresh }
                : { data: { value: null } },
        )
        routeApi(vi.fn())
        let visibility: DocumentVisibilityState = 'visible'
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
            () => visibility,
        )
        mountStatus()

        vi.advanceTimersByTime(60_000)
        expect(refresh).not.toHaveBeenCalled()
        vi.advanceTimersByTime(240_000)
        expect(refresh).toHaveBeenCalledOnce()

        document.dispatchEvent(new Event('visibilitychange'))
        expect(refresh).toHaveBeenCalledOnce()
        visibility = 'hidden'
        document.dispatchEvent(new Event('visibilitychange'))
        vi.advanceTimersByTime(300_000)
        expect(refresh).toHaveBeenCalledOnce()
        visibility = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
        expect(refresh).toHaveBeenCalledTimes(2)
    })
})
