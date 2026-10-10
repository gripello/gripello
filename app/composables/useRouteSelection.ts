import type { Ref } from 'vue'
import { listRoutes, type RouteQuery } from '~/api/routes'

export function useRouteSelection(
    gym: Readonly<Ref<string>>,
    routeQuery: Readonly<Ref<RouteQuery>>,
    totalItems: Readonly<Ref<number>>,
) {
    const queryKey = () => JSON.stringify([gym.value, routeQuery.value])

    const selectedRouteIds = ref(new Set<string>())
    let cachedIds: { filter: string; ids: string[] } | null = null

    const selectedCount = computed(() => selectedRouteIds.value.size)
    const hasSelection = computed(() => selectedCount.value > 0)
    const areAllSelected = computed(
        () => totalItems.value > 0 && selectedCount.value >= totalItems.value,
    )

    const invalidate = () => {
        cachedIds = null
    }

    const loadAllRouteIds = async () => {
        const filter = queryKey()
        if (cachedIds?.filter === filter && cachedIds.ids.length) {
            return cachedIds.ids
        }
        invalidate()
        const { items } = await listRoutes<{ id: string }>(
            gym.value,
            routeQuery.value,
            { fields: 'id' },
        )
        const ids = items.map((route) => route.id).filter(Boolean)
        cachedIds = { filter, ids }
        return ids
    }

    const update = (id: string, isSelected: boolean) => {
        const next = new Set(selectedRouteIds.value)
        if (isSelected) next.add(id)
        else next.delete(id)
        selectedRouteIds.value = next
    }

    const clear = () => {
        selectedRouteIds.value = new Set()
    }

    const remove = (ids: string[]) => {
        if (!ids.length) return
        const next = new Set(selectedRouteIds.value)
        ids.forEach((id) => next.delete(id))
        selectedRouteIds.value = next
    }

    watch(queryKey, clear)

    const toggleAll = async () => {
        if (areAllSelected.value) {
            clear()
            return
        }
        const filter = queryKey()
        const ids = await loadAllRouteIds()
        if (filter === queryKey()) selectedRouteIds.value = new Set(ids)
    }

    return {
        selectedRouteIds,
        selectedCount,
        hasSelection,
        areAllSelected,
        update,
        clear,
        remove,
        toggleAll,
        invalidate,
    }
}
