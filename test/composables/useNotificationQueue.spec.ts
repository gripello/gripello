import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref as vueRef, computed as vueComputed } from 'vue'
import { routeApi } from '../api/apiMock'

const useStateMocks: Record<string, { value: unknown }> = {}

vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
    if (!useStateMocks[key]) {
        useStateMocks[key] = vueRef(init ? init() : undefined)
    }
    return useStateMocks[key]
})

vi.stubGlobal('ref', vueRef)
vi.stubGlobal('computed', vueComputed)

let pbMock: any
vi.stubGlobal('useAuthStore', () => pbMock.authStore)

function record(id: string, read = false) {
    return { id, user: 'u1', type: 'report_filed', read, created: '' }
}

let api: ReturnType<typeof vi.fn>

function serve(items: unknown[], mutate: () => unknown = () => undefined) {
    api = vi.fn(async (path: string, options?: { method?: string }) =>
        path === '/me/notifications' && !options?.method
            ? { items, page: 1, limit: 200, total: items.length }
            : mutate(),
    )
    routeApi(api)
}

describe('useNotificationQueue', () => {
    beforeEach(() => {
        vi.resetModules()
        for (const key of Object.keys(useStateMocks)) delete useStateMocks[key]
        pbMock = { authStore: { isValid: true } }
    })

    async function loadComposable() {
        const mod = await import('~/composables/useNotificationQueue')
        return mod.useNotificationQueue()
    }

    it('counts only unread items', async () => {
        serve([record('a'), record('b', true), record('c')])

        const { refresh, items, unreadCount } = await loadComposable()
        await refresh()

        expect(items.value).toHaveLength(3)
        expect(unreadCount.value).toBe(2)
    })

    it('marks one item read and drops the count', async () => {
        serve([record('a'), record('b')])

        const { refresh, markRead, unreadCount } = await loadComposable()
        await refresh()
        await markRead('a')

        expect(api).toHaveBeenLastCalledWith('/me/notifications/read', {
            method: 'POST',
            body: { ids: ['a'] },
        })
        expect(unreadCount.value).toBe(1)
    })

    it('restores the item when marking read fails', async () => {
        serve([record('a')], () => Promise.reject(new Error('offline')))

        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})
        const { refresh, markRead, unreadCount } = await loadComposable()
        await refresh()
        await markRead('a')

        expect(unreadCount.value).toBe(1)
        consoleError.mockRestore()
    })

    it('removes a dismissed item', async () => {
        serve([record('a'), record('b')])

        const { refresh, dismiss, items } = await loadComposable()
        await refresh()
        await dismiss('a')

        expect(api).toHaveBeenLastCalledWith('/me/notifications/a', {
            method: 'DELETE',
        })
        expect(items.value.map((i: any) => i.id)).toEqual(['b'])
    })

    it('puts a dismissed item back when the delete fails', async () => {
        serve([record('a'), record('b')], () =>
            Promise.reject(new Error('offline')),
        )

        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})
        const { refresh, dismiss, items } = await loadComposable()
        await refresh()
        await dismiss('a')

        expect(items.value.map((i: any) => i.id)).toEqual(['a', 'b'])
        consoleError.mockRestore()
    })

    it('clears every unread flag in one request', async () => {
        serve([record('a'), record('b'), record('c', true)])

        const { refresh, markAllRead, unreadCount } = await loadComposable()
        await refresh()
        await markAllRead()

        expect(api).toHaveBeenLastCalledWith('/me/notifications/read', {
            method: 'POST',
            body: { ids: ['a', 'b'] },
        })
        expect(unreadCount.value).toBe(0)
    })

    it('restores every unread flag when marking all fails', async () => {
        serve([record('a'), record('b')], () =>
            Promise.reject(new Error('offline')),
        )

        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})
        const { refresh, markAllRead, unreadCount } = await loadComposable()
        await refresh()
        await markAllRead()

        expect(unreadCount.value).toBe(2)
        consoleError.mockRestore()
    })

    it('keeps the list when a refresh is aborted', async () => {
        serve([record('a')])
        const { refresh, items } = await loadComposable()
        await refresh()
        routeApi(() =>
            Promise.reject(
                Object.assign(new Error('aborted'), {
                    isAbort: true,
                    status: 0,
                }),
            ),
        )
        await refresh()

        expect(items.value).toHaveLength(1)
    })

    it('applies realtime events without refetching', async () => {
        serve([record('a')])

        const { refresh, applyEvent, items } = await loadComposable()
        await refresh()
        applyEvent({ action: 'create', record: record('b') } as never)
        applyEvent({ action: 'update', record: record('a', true) } as never)
        applyEvent({ action: 'delete', record: record('b') } as never)

        expect(items.value).toEqual([record('a', true)])
        expect(api).toHaveBeenCalledTimes(1)
    })

    it('empties the queue when signed out', async () => {
        pbMock.authStore.isValid = false
        serve([record('a')])

        const { refresh, items } = await loadComposable()
        await refresh()

        expect(items.value).toEqual([])
        expect(api).not.toHaveBeenCalled()
    })
})
