import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useRouteSelection } from '~/composables/useRouteSelection'
import type { RouteQuery } from '~/api/routes'
import { routeApi } from '../api/apiMock'

const listRoutes = vi.fn()
const gym = ref('g1')

beforeEach(() => {
    listRoutes.mockReset()
    globalThis.__AUTH_STORE__ = {}
    routeApi(listRoutes)
})

describe('useRouteSelection', () => {
    it('toggles single ids and removes a batch', () => {
        const selection = useRouteSelection(gym, ref<RouteQuery>({}), ref(3))
        selection.update('a', true)
        selection.update('b', true)
        selection.update('a', false)
        expect([...selection.selectedRouteIds.value]).toEqual(['b'])

        selection.remove(['b'])
        expect(selection.hasSelection.value).toBe(false)
    })

    it('selects all ids and reuses the cache for the same filter', async () => {
        listRoutes.mockResolvedValue({ items: [{ id: 'a' }, { id: 'b' }] })
        const filter = ref<RouteQuery>({})
        const selection = useRouteSelection(gym, filter, ref(2))

        await selection.toggleAll()
        expect(selection.areAllSelected.value).toBe(true)

        await selection.toggleAll()
        expect(selection.hasSelection.value).toBe(false)

        await selection.toggleAll()
        expect(listRoutes).toHaveBeenCalledTimes(1)

        selection.clear()
        filter.value = { archived: true }
        await selection.toggleAll()
        expect(listRoutes).toHaveBeenCalledTimes(2)
        expect(listRoutes).toHaveBeenLastCalledWith('/gyms/g1/routes', {
            query: expect.objectContaining({ archived: 'true', limit: 1000 }),
        })
    })

    it('refetches after invalidate', async () => {
        listRoutes.mockResolvedValue({ items: [{ id: 'a' }] })
        const selection = useRouteSelection(gym, ref<RouteQuery>({}), ref(1))
        await selection.toggleAll()
        selection.clear()
        selection.invalidate()
        await selection.toggleAll()
        expect(listRoutes).toHaveBeenCalledTimes(2)
    })

    it('clears the selection when the filter changes', async () => {
        listRoutes.mockResolvedValue({ items: [{ id: 'a' }, { id: 'b' }] })
        const filter = ref<RouteQuery>({})
        const totalItems = ref(2)
        const selection = useRouteSelection(gym, filter, totalItems)
        await selection.toggleAll()
        expect(selection.areAllSelected.value).toBe(true)

        filter.value = { archived: true }
        totalItems.value = 1
        await nextTick()
        expect(selection.hasSelection.value).toBe(false)
        expect(selection.areAllSelected.value).toBe(false)
    })

    it('drops a select-all result that resolves after the filter changed', async () => {
        let resolveIds: (ids: { id: string }[]) => void = () => {}
        listRoutes.mockReturnValue(
            new Promise(
                (resolve) => (resolveIds = (items) => resolve({ items })),
            ),
        )
        const filter = ref<RouteQuery>({})
        const selection = useRouteSelection(gym, filter, ref(2))
        const pending = selection.toggleAll()
        filter.value = { archived: true }
        resolveIds([{ id: 'a' }, { id: 'b' }])
        await pending
        expect(selection.hasSelection.value).toBe(false)
    })
})
