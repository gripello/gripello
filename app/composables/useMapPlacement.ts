import type { Ref } from 'vue'
import type { RouteRecord, WallRecord } from '~/types/models'
import type { RouteTypeFilter } from '~/components/map/FilterChips.vue'
import {
    autoDistribute,
    clampUnit,
    hasAnchorRange,
    insertByAnchor,
    isDescendingRange,
    roundToCm,
    wallForAnchor,
} from '#shared/utils/mapGeometry'
import { formatGrade, gradeKey } from '#shared/utils/grades'
import { toHex6 } from '~/utils/color'
import {
    applyPlacements,
    placementChanges,
    routesOnWall,
    type MapWall,
    type Placement,
} from '~/utils/gymMap'

const NUDGE_STEP = 0.02
const HISTORY_LIMIT = 100
const DAY_MS = 86_400_000

export function useMapPlacement(
    routes: Ref<RouteRecord[]>,
    walls: Ref<WallRecord[]>,
    mapWalls: Ref<MapWall[]>,
) {
    const pending = ref(new Map<string, Placement>())
    const history = ref<Map<string, Placement>[]>([])

    const selectedRouteId = ref<string | null>(null)
    const selectedWallId = ref<string | null>(null)
    const armedRouteId = ref<string | null>(null)
    const checkedIds = ref(new Set<string>())
    const keepGoing = ref(true)

    const tab = ref<'unplaced' | 'placed'>('unplaced')
    const search = ref('')
    const gradeFilter = ref<string | null>(null)
    const colorFilter = ref<string | null>(null)
    const typeFilter = ref<RouteTypeFilter>('')

    const wallIds = computed(
        () => new Set(mapWalls.value.map((wall) => wall.id)),
    )
    const effectiveRoutes = computed(() =>
        applyPlacements(routes.value, pending.value),
    )
    const changes = computed(() =>
        placementChanges(routes.value, pending.value),
    )

    const isPlaced = (item: { wall?: string | null }) =>
        !!item.wall && wallIds.value.has(item.wall)
    const findRoute = (routeId: string | null) =>
        effectiveRoutes.value.find((item) => item.id === routeId)

    const unplacedRoutes = computed(() =>
        effectiveRoutes.value.filter((item) => !isPlaced(item)),
    )
    const placedRoutes = computed(() => effectiveRoutes.value.filter(isPlaced))
    const gradeOptions = computed(() =>
        [
            ...new Set(
                effectiveRoutes.value
                    .filter((item) => formatGrade(item))
                    .sort(
                        (a, b) =>
                            (a.type ?? '').localeCompare(b.type ?? '') ||
                            (a.grade_index ?? 0) - (b.grade_index ?? 0),
                    )
                    .map((item) => gradeKey(item, true)),
            ),
        ].map((grade) => ({ title: grade, value: grade })),
    )
    const colorOptions = computed(() => [
        ...new Set(
            effectiveRoutes.value
                .map((item) => toHex6(item.color))
                .filter(Boolean),
        ),
    ])
    const activeFilterCount = computed(
        () =>
            [
                search.value,
                gradeFilter.value,
                colorFilter.value,
                typeFilter.value,
            ].filter(Boolean).length,
    )

    function matchesFilters(item: RouteRecord) {
        const query = (search.value ?? '').trim().toLowerCase()
        return (
            (!query || item.name.toLowerCase().includes(query)) &&
            (!gradeFilter.value ||
                gradeKey(item, true) === gradeFilter.value) &&
            (!colorFilter.value || toHex6(item.color) === colorFilter.value) &&
            (!typeFilter.value || item.type === typeFilter.value)
        )
    }

    function clearFilters() {
        search.value = ''
        gradeFilter.value = null
        colorFilter.value = null
        typeFilter.value = ''
    }

    const listedUnplaced = computed(() =>
        unplacedRoutes.value.filter(matchesFilters),
    )
    const listedRoutes = computed(() =>
        tab.value === 'unplaced'
            ? listedUnplaced.value
            : placedRoutes.value.filter(matchesFilters),
    )

    const canvasArmedId = computed(
        () =>
            armedRouteId.value ??
            checkedIds.value.values().next().value ??
            null,
    )
    const selectedPlaced = computed(() => {
        const item = findRoute(selectedRouteId.value)
        return item && isPlaced(item) ? item : null
    })
    const armedRoute = computed(() => findRoute(armedRouteId.value) ?? null)

    function isDescending(wallId: string) {
        const wall = walls.value.find((record) => record.id === wallId)
        return !!wall && isDescendingRange(wall)
    }

    const hasAnchorRanges = computed(() => walls.value.some(hasAnchorRange))
    const autoPlacements = computed(() => {
        const ranged = walls.value.filter(
            (wall) => wallIds.value.has(wall.id) && hasAnchorRange(wall),
        )
        const incomingByWall = new Map<string, RouteRecord[]>()
        for (const item of unplacedRoutes.value) {
            const wallId = wallForAnchor(ranged, item.anchor_point)
            if (wallId)
                incomingByWall.set(wallId, [
                    ...(incomingByWall.get(wallId) ?? []),
                    item,
                ])
        }
        const placements = new Map<string, Placement>()
        for (const [wallId, incoming] of incomingByWall)
            for (const [routeId, position] of insertByAnchor(
                routesOnWall(effectiveRoutes.value, wallId),
                incoming,
                isDescending(wallId),
            ))
                placements.set(routeId, { wall: wallId, position })
        return placements
    })

    const selectedWall = computed(() =>
        mapWalls.value.find((wall) => wall.id === selectedWallId.value),
    )
    const wallRoutes = computed(() =>
        selectedWallId.value
            ? routesOnWall(effectiveRoutes.value, selectedWallId.value)
            : [],
    )
    const savedWallRouteIds = computed(() =>
        selectedWallId.value
            ? routesOnWall(routes.value, selectedWallId.value).map(
                  (item) => item.id,
              )
            : [],
    )
    const wallAge = computed(() => {
        const now = Date.now()
        const ages = wallRoutes.value
            .filter((item) => !item.permanent)
            .map((item) =>
                item.screw_date
                    ? (now -
                          new Date(
                              item.screw_date.replace(' ', 'T'),
                          ).getTime()) /
                      DAY_MS
                    : NaN,
            )
            .filter((age) => Number.isFinite(age) && age >= 0)
        if (!ages.length) return null
        return {
            oldest: Math.round(Math.max(...ages)),
            average: Math.round(
                ages.reduce((sum, age) => sum + age, 0) / ages.length,
            ),
        }
    })

    function update(next: Map<string, Placement>) {
        history.value = [...history.value, pending.value].slice(-HISTORY_LIMIT)
        pending.value = next
    }

    function nextUnplacedAfter(routeId: string) {
        const order = listedUnplaced.value
        const index = order.findIndex((item) => item.id === routeId)
        return index === -1 ? null : (order[index + 1]?.id ?? null)
    }

    function placeChecked(wallId: string) {
        const incoming = effectiveRoutes.value.filter((item) =>
            checkedIds.value.has(item.id),
        )
        const placed = routesOnWall(effectiveRoutes.value, wallId).filter(
            (item) => !checkedIds.value.has(item.id),
        )
        const next = new Map(pending.value)
        for (const [routeId, position] of insertByAnchor(
            placed,
            incoming,
            isDescending(wallId),
        ))
            next.set(routeId, { wall: wallId, position })
        update(next)
        checkedIds.value = new Set()
        selectedWallId.value = wallId
    }

    function place(routeId: string, wallId: string, position: number) {
        if (checkedIds.value.has(routeId) && !armedRouteId.value) {
            placeChecked(wallId)
            return
        }
        const wasArmed = routeId === armedRouteId.value
        const following = wasArmed ? nextUnplacedAfter(routeId) : null
        const next = new Map(pending.value)
        next.set(routeId, { wall: wallId, position })
        update(next)
        if (wasArmed) armedRouteId.value = keepGoing.value ? following : null
        selectedRouteId.value = routeId
    }

    function arm(routeId: string) {
        armedRouteId.value = armedRouteId.value === routeId ? null : routeId
        selectedRouteId.value = routeId
    }

    function cancelArming() {
        armedRouteId.value = null
        checkedIds.value = new Set()
    }

    function toggleChecked(routeId: string) {
        const next = new Set(checkedIds.value)
        if (!next.delete(routeId)) next.add(routeId)
        checkedIds.value = next
        armedRouteId.value = null
    }

    function autoPlace() {
        update(new Map([...pending.value, ...autoPlacements.value]))
        cancelArming()
    }

    function skipArmed() {
        if (!armedRouteId.value) return
        armedRouteId.value =
            nextUnplacedAfter(armedRouteId.value) ??
            listedUnplaced.value[0]?.id ??
            null
    }

    function nudge(direction: 1 | -1) {
        const item = selectedPlaced.value
        if (!item) return
        const next = new Map(pending.value)
        next.set(item.id, {
            wall: item.wall ?? null,
            position: roundToCm(
                clampUnit((item.wall_position ?? 0.5) + direction * NUDGE_STEP),
            ),
        })
        update(next)
    }

    function unplace(routeId: string) {
        const next = new Map(pending.value)
        next.set(routeId, { wall: null, position: null })
        update(next)
        if (selectedRouteId.value === routeId) selectedRouteId.value = null
    }

    function distribute() {
        const next = new Map(pending.value)
        for (const [routeId, position] of autoDistribute(wallRoutes.value))
            next.set(routeId, { wall: selectedWallId.value, position })
        update(next)
    }

    function undo() {
        const previous = history.value.at(-1)
        if (!previous) return
        pending.value = previous
        history.value = history.value.slice(0, -1)
    }

    function reset() {
        pending.value = new Map()
        history.value = []
    }

    return {
        pending,
        history,
        changes,
        effectiveRoutes,
        selectedRouteId,
        selectedWallId,
        armedRouteId,
        armedRoute,
        checkedIds,
        keepGoing,
        tab,
        search,
        gradeFilter,
        colorFilter,
        typeFilter,
        activeFilterCount,
        clearFilters,
        isPlaced,
        findRoute,
        unplacedRoutes,
        placedRoutes,
        gradeOptions,
        colorOptions,
        listedUnplaced,
        listedRoutes,
        canvasArmedId,
        selectedPlaced,
        hasAnchorRanges,
        autoPlacements,
        selectedWall,
        wallRoutes,
        savedWallRouteIds,
        wallAge,
        place,
        arm,
        cancelArming,
        toggleChecked,
        autoPlace,
        skipArmed,
        nudge,
        unplace,
        distribute,
        undo,
        reset,
    }
}
