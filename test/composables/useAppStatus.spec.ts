import { describe, expect, it, vi } from 'vitest'
import { useAppStatus } from '~/composables/useAppStatus'
import { routeApi } from '../api/apiMock'

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
        useAppStatus()
        expect(enabled['footer:health']).toBeUndefined()
        expect(enabled['footer:online']?.()).toBe(false)
        store.isValid = true
        expect(enabled['footer:online']?.()).toBe(true)
    })
})
