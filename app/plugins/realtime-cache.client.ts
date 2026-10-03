import type { RecordSubscription } from 'pocketbase'
import type {
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
    coalesce,
    defectsScope,
    detailRouteId,
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
    type KeyLocations,
    type OpenDefectsChange,
    type RatingChange,
    type RatingLedger,
    type RowsData,
} from '~/utils/realtimeCache'

const RECONNECT_SPREAD_MS = 5000

export default defineNuxtPlugin((nuxtApp) => {
    const pb = usePocketbase()
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
        const scores = await pb
            .collection('averageRating')
            .getFullList<RouteScoreRecord>({
                filter: ids
                    .map((id) => pb.filter('id = {:id}', { id }))
                    .join(' || '),
                fields: 'id,average_rating,ratings_count',
                requestKey: null,
            })
        for (const score of scores)
            patchRouteRows((rows) => patchList(rows, score, null))
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

    function onRating({ action, record }: RecordSubscription<RatingRecord>) {
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

    function onRoute({ action, record }: RecordSubscription<RouteRecord>) {
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
    }

    function onWall({ action, record }: RecordSubscription<WallRecord>) {
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

    function onLocation({
        action,
        record,
    }: RecordSubscription<LocationRecord>) {
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
            const next = replaceRouteDefects(data, change, inScope)
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

    function onOwnTick({ record }: RecordSubscription<TickRecord>) {
        if (record.user === pb.authStore.record?.id) refreshOwnTicksSoon()
    }

    const hydratedFromStaleCache = servedStaleFromSsrCache(
        document.documentElement.dataset.ssrAge,
    )
    let awaitingFirstConnect = !pb.realtime.isConnected

    function refreshLiveKeys(spreadMs: number) {
        setTimeout(() => {
            const keys = loadedKeys().filter((key) =>
                isLiveKey(key, keyLocations.value),
            )
            if (keys.length) void refreshNuxtData(keys)
        }, Math.random() * spreadMs)
    }

    function onConnect() {
        if (!awaitingFirstConnect) return refreshLiveKeys(RECONNECT_SPREAD_MS)
        awaitingFirstConnect = false
        if (hydratedFromStaleCache) refreshLiveKeys(0)
    }

    nuxtApp.hook('app:mounted', () => {
        const subscriptions = [
            pb.realtime.subscribe('PB_CONNECT', onConnect),
            pb.collection('ratings').subscribe<RatingRecord>('*', onRating),
            pb.collection('routes').subscribe<RouteRecord>('*', onRoute),
            pb.collection('walls').subscribe<WallRecord>('*', onWall),
            pb
                .collection('locations')
                .subscribe<LocationRecord>('*', onLocation),
            pb.realtime.subscribe(liveTopics.openDefects, onOpenDefects),
            pb.realtime.subscribe(liveTopics.ownTicks, onOwnTick),
        ]
        for (const subscription of subscriptions)
            subscription.catch((error) =>
                console.error('Realtime subscription failed:', error),
            )
    })

    return { provide: { realtimeCache: { applyRating, revertRating } } }
})
