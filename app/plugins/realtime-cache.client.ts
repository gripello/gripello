import { listRoutes } from '~/api/routes'
import {
    isRealtimeConnected,
    onConnect as onRealtimeConnect,
    subscribeRealtime,
    type RecordChange,
} from '~/composables/useRealtime'
import type {
    BetaVideoRecord,
    LocationRecord,
    OpenRouteDefectRecord,
    RatingRecord,
    RouteRecord,
    RouteScoreRecord,
    TickRecord,
    WallRecord,
} from '~/types/models'
import {
    applyRatingChange,
    cacheKeys,
    isFollowKey,
    coalesce,
    defectsScope,
    detailRouteId,
    gymChangesTopic,
    gymDefectsTopic,
    liveTopics,
    servedStaleFromSsrCache,
    isLiveKey,
    mapRows,
    NEW_ROUTE_SCORE,
    patchExpanded,
    patchList,
    ratingsRouteId,
    relinkRow,
    removeById,
    replaceRouteDefects,
    routeRowsScope,
    rowsOf,
    trackRating,
    upsertById,
    wallsScope,
    type ExpandField,
    type GymChange,
    type GymChangeCollection,
    type KeyLocations,
    type OpenDefectsChange,
    type RatingChange,
    type RatingLedger,
    type RowsData,
} from '~/utils/realtimeCache'

const RECONNECT_SPREAD_MS = 5000

export default defineNuxtPlugin((nuxtApp) => {
    const authStore = useAuthStore()
    // ponytail: grows by one small entry per rating seen this session
    const ratingLedger: RatingLedger = new Map()
    const routesToRescore = new Set<string>()
    const { id: liveGym } = useGym()
    const inLiveGym = (record: { gym?: string }) =>
        !!record.gym && record.gym === liveGym.value
    const keyLocations = useState<KeyLocations>(
        cacheKeys.keyLocations,
        () => ({}),
    )

    function loadedKeys() {
        return Object.keys(nuxtApp.payload.data).filter(
            (key) => nuxtApp.payload.data[key] !== undefined,
        )
    }

    function read<T>(key: string): T {
        return (nuxtApp._asyncData[key]?.data.value ??
            nuxtApp.payload.data[key]) as T
    }

    function write<T>(key: string, value: T) {
        const entry = nuxtApp._asyncData[key]
        if (entry) entry.data.value = value
        else nuxtApp.payload.data[key] = value
    }

    function patchRouteRows(
        patch: (
            rows: RouteScoreRecord[],
            inScope: (route: RouteRecord) => boolean | null,
        ) => RouteScoreRecord[],
    ) {
        for (const key of loadedKeys()) {
            const inScope = routeRowsScope(key, keyLocations.value)
            if (!inScope) continue
            const data = read<RowsData<RouteScoreRecord>>(key)
            const next = mapRows(data, (rows) => patch(rows, inScope))
            if (next !== data) write(key, next)
        }
    }

    function patchRatingLists(
        patch: (ratings: RatingRecord[], routeId: string) => RatingRecord[],
    ) {
        for (const key of loadedKeys()) {
            const routeId = ratingsRouteId(key)
            if (routeId === undefined) continue
            const data = read<RatingRecord[]>(key)
            const next = patch(data, routeId)
            if (next !== data) write(key, next)
        }
    }

    function cachedRating(id: string) {
        for (const key of loadedKeys()) {
            if (ratingsRouteId(key) === undefined) continue
            const found = read<RatingRecord[]>(key).find(
                (rating) => rating.id === id,
            )
            if (found) return found
        }
    }

    function hasRouteRow(routeId: string) {
        return loadedKeys().some(
            (key) =>
                !!routeRowsScope(key, keyLocations.value) &&
                rowsOf(read<RowsData<RouteScoreRecord>>(key)).some(
                    (row) => row.id === routeId,
                ),
        )
    }

    const rescoreSoon = coalesce(async () => {
        const ids = [...routesToRescore]
        routesToRescore.clear()
        const { items: scores } = await listRoutes(
            null,
            { ids, archived: 'all' },
            {
                rated: true,
                fields: 'id,average_rating,ratings_count',
                requestKey: null,
            },
        )
        for (const { id, average_rating, ratings_count } of scores)
            patchRouteRows((rows) =>
                patchList(
                    rows,
                    { id, average_rating, ratings_count } as RouteScoreRecord,
                    null,
                ),
            )
    })

    const refreshUnplacedSoon = coalesce(() =>
        refreshNuxtData(cacheKeys.unplacedRoutes),
    )

    const refreshRoutesListSoon = coalesce(() =>
        refreshNuxtData(cacheKeys.routesList),
    )

    function cachedRecord(id: string) {
        for (const key of loadedKeys()) {
            if (
                key !== cacheKeys.locations &&
                !wallsScope(key, keyLocations.value)
            )
                continue
            const found = read<{ id: string }[]>(key).find(
                (record) => record.id === id,
            )
            if (found) return found
        }
    }

    function patchExpandedEverywhere(
        field: ExpandField,
        record: { id: string },
    ) {
        patchRouteRows((rows) => patchExpanded(rows, field, record))
        for (const key of loadedKeys()) {
            if (detailRouteId(key) === undefined) continue
            const route = read<RouteRecord | null>(key)
            if (!route) continue
            const [next] = patchExpanded([route], field, record)
            if (next !== route) write(key, next)
        }
    }

    function applyChange(change: RatingChange | 'unknown' | null) {
        if (change && change !== 'unknown')
            patchRouteRows((rows) => applyRatingChange(rows, change))
    }

    function applyRating(rating: RatingRecord) {
        patchRatingLists((ratings, routeId) =>
            routeId === rating.route_id
                ? upsertById(ratings, rating, 'start')
                : ratings,
        )
        applyChange(trackRating(ratingLedger, 'create', rating))
    }

    function revertRating(rating: RatingRecord) {
        patchRatingLists((ratings) => removeById(ratings, rating.id))
        applyChange(trackRating(ratingLedger, 'delete', rating))
    }

    function onRating({ action, record }: GymChange<RatingRecord>) {
        if (!inLiveGym(record)) return
        if (action === 'create') return applyRating(record)
        if (action === 'delete') return revertRating(record)
        const change = trackRating(
            ratingLedger,
            action,
            record,
            cachedRating(record.id),
        )
        patchRatingLists((ratings, routeId) =>
            routeId === record.route_id
                ? upsertById(ratings, record, 'start')
                : removeById(ratings, record.id),
        )
        if (change !== 'unknown') return applyChange(change)
        if (!record.route_id || !hasRouteRow(record.route_id)) return
        routesToRescore.add(record.route_id)
        rescoreSoon()
    }

    function onRoute({ action, record }: GymChange<RouteRecord>) {
        if (!inLiveGym(record)) return
        const removed = action === 'delete' || !!record.archived
        patchRouteRows((rows, inScope) =>
            relinkRow(
                patchList<RouteScoreRecord>(
                    rows,
                    record,
                    removed ? false : inScope(record),
                    NEW_ROUTE_SCORE,
                ),
                record.id,
                cachedRecord,
            ),
        )
        const keys = loadedKeys()
        if (action === 'create' && keys.includes(cacheKeys.routesList))
            refreshRoutesListSoon()
        if (action !== 'delete' && keys.includes(cacheKeys.route(record.id)))
            void refreshNuxtData(cacheKeys.route(record.id))
        if (keys.includes(cacheKeys.unplacedRoutes)) refreshUnplacedSoon()
        if (keys.includes(cacheKeys.communityFeed)) refreshCommunityFeedSoon()
    }

    const refreshCommunityFeedSoon = coalesce(() =>
        refreshNuxtData(cacheKeys.communityFeed),
    )

    function onBetaVideo({ record }: GymChange<BetaVideoRecord>) {
        if (inLiveGym(record) && loadedKeys().includes(cacheKeys.communityFeed))
            refreshCommunityFeedSoon()
    }

    function onWall({ action, record }: GymChange<WallRecord>) {
        if (!inLiveGym(record)) return
        for (const key of loadedKeys()) {
            const inScope = wallsScope(key, keyLocations.value)
            if (!inScope) continue
            const data = read<WallRecord[]>(key)
            const next = patchList(
                data,
                record,
                action === 'delete' ? false : inScope(record),
            )
            if (next !== data) write(key, next)
        }
        if (action !== 'delete') patchExpandedEverywhere('wall', record)
    }

    function onLocation({ action, record }: GymChange<LocationRecord>) {
        if (!inLiveGym(record)) return
        const data = read<LocationRecord[] | undefined>(cacheKeys.locations)
        if (data) {
            const next = patchList(data, record, action !== 'delete')
            if (next !== data) write(cacheKeys.locations, next)
        }
        if (action !== 'delete') patchExpandedEverywhere('location', record)
    }

    function onOpenDefects(change: OpenDefectsChange) {
        for (const key of loadedKeys()) {
            const inScope = defectsScope(key)
            if (!inScope) continue
            const data = read<OpenRouteDefectRecord[]>(key)
            const next = replaceRouteDefects(
                data,
                change,
                inScope,
                liveGym.value,
            )
            if (next !== data) write(key, next)
        }
    }

    const refreshOwnTicksSoon = coalesce(() => {
        const keys = loadedKeys().filter(
            (key) =>
                key === cacheKeys.tickedRoutes || key === cacheKeys.logbook,
        )
        return keys.length ? refreshNuxtData(keys) : Promise.resolve()
    }, 300)

    function onOwnTick({ record }: RecordChange<TickRecord>) {
        if (record.user === authStore.record?.id) refreshOwnTicksSoon()
    }

    const refreshFollowsSoon = coalesce(() => {
        const keys = loadedKeys().filter(isFollowKey)
        return keys.length ? refreshNuxtData(keys) : Promise.resolve()
    }, 300)

    const hydratedFromStaleCache = servedStaleFromSsrCache(
        document.documentElement.dataset.ssrAge,
    )
    let awaitingFirstConnect = !isRealtimeConnected()

    function refreshLiveKeys(spreadMs: number) {
        setTimeout(() => {
            const keys = loadedKeys().filter((key) =>
                isLiveKey(key, keyLocations.value),
            )
            if (keys.length) void refreshNuxtData(keys)
        }, Math.random() * spreadMs)
    }

    function onConnect(afterDrop: boolean) {
        if (!awaitingFirstConnect) {
            if (afterDrop) refreshLiveKeys(RECONNECT_SPREAD_MS)
            return
        }
        awaitingFirstConnect = false
        if (hydratedFromStaleCache) refreshLiveKeys(0)
    }

    const gymChangeHandlers: Record<
        GymChangeCollection,
        (change: GymChange<never>) => void
    > = {
        ratings: onRating,
        routes: onRoute,
        walls: onWall,
        locations: onLocation,
        beta_videos: onBetaVideo,
    }

    function onGymChange(change: GymChange) {
        gymChangeHandlers[change.collection]?.(change as GymChange<never>)
    }

    nuxtApp.hook('app:mounted', () => {
        watch(
            liveGym,
            (gymId, _, onCleanup) => {
                if (!gymId) return
                const stops = [
                    subscribeRealtime(gymChangesTopic(gymId), onGymChange),
                    subscribeRealtime(gymDefectsTopic(gymId), onOpenDefects),
                ]
                onCleanup(() => stops.forEach((stop) => stop()))
            },
            { immediate: true },
        )
        onRealtimeConnect(onConnect)
        subscribeRealtime(liveTopics.ownTicks, onOwnTick)
        subscribeRealtime(liveTopics.followChanges, refreshFollowsSoon)
        subscribeRealtime(liveTopics.followedTicks, refreshFollowsSoon)
    })

    return { provide: { realtimeCache: { applyRating, revertRating } } }
})
