import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { RouteRecord } from '~/types/models'
import { loadSession, persistSession } from '~/utils/inventory'

const archiveRoute = vi.fn()
const listRoutes = vi.fn()
vi.mock('~/api/routes', () => ({
    archiveRoute: (...args: unknown[]) => archiveRoute(...args),
    listRoutes: (...args: unknown[]) => listRoutes(...args),
}))
vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
vi.stubGlobal('useNotification', () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
}))
vi.stubGlobal('useRealtime', vi.fn())
const onMounted = vi.fn()
vi.stubGlobal('onMounted', onMounted)

const { useInventorySession } =
    await import('~/composables/useInventorySession')

const route = (id: string, extra: Partial<RouteRecord> = {}) =>
    ({ id, name: id, location: 'l1', ...extra }) as RouteRecord

function session() {
    const inventory = useInventorySession({
        gymId: ref('g1'),
        onLoadError: vi.fn(),
    })
    inventory.allRoutes.value = [
        route('r1'),
        route('r2', { archived: true }),
        route('r3', { location: 'l2' }),
    ]
    inventory.sessionLocation.value = 'l1'
    return inventory
}

describe('useInventorySession', () => {
    beforeEach(() => {
        localStorage.clear()
        archiveRoute.mockReset().mockResolvedValue({})
    })

    it('accepts a route once and ignores the same code during the cooldown', async () => {
        const inventory = session()
        expect(await inventory.scan('https://gripello.app/route?id=r1')).toBe(
            'accepted',
        )
        expect(
            await inventory.scan('https://gripello.app/route?id=r1'),
        ).toBeNull()
        inventory.undoScan(route('r1'))
        expect(await inventory.scan('https://gripello.app/route?id=r1')).toBe(
            'accepted',
        )
        expect(inventory.scannedRouteIds.value).toEqual(['r1'])
    })

    it('rejects unknown codes and routes of another location', async () => {
        const inventory = session()
        expect(await inventory.scan('nope')).toBe('rejected')
        expect(await inventory.scan('https://gripello.app/route?id=r3')).toBe(
            'rejected',
        )
    })

    it('restores an archived route it finds on the wall', async () => {
        const inventory = session()
        expect(await inventory.scan('https://gripello.app/route?id=r2')).toBe(
            'accepted',
        )
        expect(archiveRoute).toHaveBeenCalledWith('r2', false)
        expect(inventory.allRoutes.value[1]!.archived).toBe(false)
        expect(inventory.progress.value).toBe(50)
    })

    it('reports a counted route as duplicate and clears on reset', async () => {
        const inventory = session()
        inventory.markFound(route('r1'))
        expect(await inventory.scan('https://gripello.app/route?id=r1')).toBe(
            'duplicate',
        )
        inventory.reset()
        expect(inventory.scannedRouteIds.value).toEqual([])
    })

    it('ignores an aborted route load but reports other failures', async () => {
        const onLoadError = vi.fn()
        const inventory = useInventorySession({ gymId: ref('g1'), onLoadError })
        listRoutes.mockRejectedValueOnce({ isAbort: true })
        await inventory.loadRoutes()
        expect(onLoadError).not.toHaveBeenCalled()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        listRoutes.mockRejectedValueOnce(new Error('boom'))
        await inventory.loadRoutes()
        expect(onLoadError).toHaveBeenCalledOnce()
    })

    it("ignores another gym's session and leaves it stored", async () => {
        persistSession('g2', { location: 'l9', ids: ['x1'] })
        onMounted.mockClear()
        const inventory = useInventorySession({
            gymId: ref('g1'),
            onLoadError: vi.fn(),
        })
        onMounted.mock.calls[0]![0]()
        expect(inventory.sessionLocation.value).toBeNull()
        expect(inventory.scannedRouteIds.value).toEqual([])

        inventory.reset()
        expect(loadSession('g2')).toEqual({ location: 'l9', ids: ['x1'] })
    })
})
