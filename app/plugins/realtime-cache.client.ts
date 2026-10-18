import { listRoutes } from '~/api/routes'
import { routeMatchesQuery } from '~/utils/routeSearch'
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
    SeasonRecord,
    SettingsRecord,
    TickRecord,
    WallRecord,
} from '~/types/models'
import {
    applyRatingChange,
    cacheKeys,
    isFollowKey,
    isOwnTickKey,
    coalesce,
    defectsScope,
    detailRouteId,
    gymChangesTopic,
    gymDefectsTopic,
    liveTopics,
    servedStaleFromSsrCache,
    showsClimber,
    splitFollowRefresh,
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
    type KeyQueries,
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
    const keyQueries = useState<KeyQueries>(cacheKeys.keyQueries, () => ({}))

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
            const inScope = routeRowsScope(
                key,
                keyLocations.value,
                keyQueries.value,
            )
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
        const { items: scores } = await listRoutes(null, {
            ids,
            archived: 'all',
        })
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

    // every viewer of the list refetches it, so spread them wider than other refreshes
    const refreshRoutesListSoon = coalesce(
        () => refreshNuxtData(cacheKeys.routesList),
        5000,
    )

    // ponytail: one small timer entry per route opened this session
    const routeDetailRefreshes = new Map<string, () => void>()
    function refreshRouteDetailSoon(routeId: string) {
        let soon = routeDetailRefreshes.get(routeId)
        if (!soon) {
            soon = coalesce(() => refreshNuxtData(cacheKeys.route(routeId)))
            routeDetailRefreshes.set(routeId, soon)
        }
        soon()
    }

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

    function routesListNeedsRow(
        record: RouteRecord,
        action: GymChange['action'],
    ) {
        const query = keyQueries.value[cacheKeys.routesList]
        if (action === 'delete' || !query) return action === 'create'
        return (
            routeMatchesQuery(record, query) &&
            !rowsOf(
                read<RowsData<RouteScoreRecord>>(cacheKeys.routesList),
            ).some((row) => row.id === record.id)
        )
    }

    function patchMapMatches(record: RouteRecord, removed: boolean) {
        const query = keyQueries.value[cacheKeys.mapMatching]
        const matches = read<{ id: string }[] | null>(cacheKeys.mapMatching)
        if (!query || !matches) return
        const next = patchList(
            matches,
            { id: record.id },
            !removed && routeMatchesQuery(record, query),
        )
        if (next !== matches) write(cacheKeys.mapMatching, next)
    }

    function onRoute({ action, record }: GymChange<RouteRecord>) {
        if (!inLiveGym(record)) return
        const removed = action === 'delete' || !!record.archived
        const keys = loadedKeys()
        const listNeedsRow =
            keys.includes(cacheKeys.routesList) &&
            routesListNeedsRow(record, action)
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
        if (listNeedsRow) refreshRoutesListSoon()
        if (keys.includes(cacheKeys.mapMatching))
            patchMapMatches(record, action === 'delete')
        if (keys.includes(cacheKeys.route(record.id))) {
            if (action === 'delete') write(cacheKeys.route(record.id), null)
            else refreshRouteDetailSoon(record.id)
        }
        if (keys.includes(cacheKeys.unplacedRoutes)) refreshUnplacedSoon()
        if (keys.includes(cacheKeys.communityFeed)) refreshCommunityFeedSoon()
    }

    const refreshCommunityFeedSoon = coalesce(() =>
        refreshNuxtData(cacheKeys.communityFeed),
    )

    function onBetaVideo({ action, record }: GymChange<BetaVideoRecord>) {
        if (!inLiveGym(record)) return
        const key = cacheKeys.betas(record.route)
        const videos = read<BetaVideoRecord[] | undefined>(key)
        if (videos) {
            const next =
                action === 'delete'
                    ? removeById(videos, record.id)
                    : upsertById(videos, record, 'start')
            if (next !== videos) write(key, next)
        }
        if (loadedKeys().includes(cacheKeys.communityFeed))
            refreshCommunityFeedSoon()
    }

    const refreshLeaderboardSoon = coalesce(() =>
        refreshNuxtData(cacheKeys.leaderboard),
    )

    function onSeason({ action, record }: GymChange<SeasonRecord>) {
        if (!inLiveGym(record)) return
        const seasons = read<SeasonRecord[] | undefined>(cacheKeys.seasons)
        if (seasons)
            write(
                cacheKeys.seasons,
                patchList(seasons, record, action !== 'delete'),
            )
        // the shown board may cover the season whose dates changed
        if (loadedKeys().includes(cacheKeys.leaderboard))
            refreshLeaderboardSoon()
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
        if (loadedKeys().includes(cacheKeys.unplacedRoutes))
            refreshUnplacedSoon()
        if (action !== 'delete') patchExpandedEverywhere('wall', record)
    }

    function onLocation({ action, record }: GymChange<LocationRecord>) {
        if (!inLiveGym(record)) return
        const data = read<LocationRecord[] | undefined>(cacheKeys.locations)
        if (data) {
            const next = patchList(data, record, action !== 'delete')
            if (next !== data) write(cacheKeys.locations, next)
        }
        if (loadedKeys().includes(cacheKeys.unplacedRoutes))
            refreshUnplacedSoon()
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
        const keys = loadedKeys().filter(isOwnTickKey)
        return keys.length ? refreshNuxtData(keys) : Promise.resolve()
    }, 300)

    // the achievements job runs a moment after the tick, so wait past its coalescing
    const refreshOwnAchievementsSoon = coalesce(() => {
        const key = cacheKeys.achievements(authStore.record?.id ?? '')
        return loadedKeys().includes(key)
            ? refreshNuxtData(key)
            : Promise.resolve()
    }, 3000)

    function onOwnTick({ record }: RecordChange<TickRecord>) {
        if (record.user !== authStore.record?.id) return
        refreshOwnTicksSoon()
        refreshOwnAchievementsSoon()
    }

    function onOwnNotification({
        action,
        record,
    }: RecordChange<{ type?: string }>) {
        if (action === 'create' && record.type === 'achievement_earned')
            refreshOwnAchievementsSoon()
    }

    const refreshFollowsSoon = coalesce(async () => {
        const keys = loadedKeys().filter(isFollowKey)
        const [first, then] = splitFollowRefresh(keys)
        if (first.length) await refreshNuxtData(first)
        if (then.length) await refreshNuxtData(then)
    }, 300)

    const refreshBlocksSoon = coalesce(
        () => refreshNuxtData(cacheKeys.blocks),
        300,
    )

    function onFollowChange(event: { kind?: string }) {
        if (event.kind?.startsWith('block.')) refreshBlocksSoon()
        else refreshFollowsSoon()
    }

    const changedClimbers = new Set<string>()
    const refreshClimbersSoon = coalesce(() => {
        const ids = [...changedClimbers]
        changedClimbers.clear()
        const keys = loadedKeys().filter((key) =>
            ids.some((id) => showsClimber(key, read(key), id)),
        )
        return keys.length ? refreshNuxtData(keys) : Promise.resolve()
    })

    function onClimberChange({ id }: { id: string }) {
        changedClimbers.add(id)
        refreshClimbersSoon()
    }

    function onSettings({
        kind: _,
        ...settings
    }: SettingsRecord & { kind?: string }) {
        if (read(cacheKeys.settings) !== undefined)
            write(cacheKeys.settings, settings)
    }

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
        seasons: onSeason,
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
        subscribeRealtime(liveTopics.ownNotifications, onOwnNotification)
        subscribeRealtime(liveTopics.followChanges, onFollowChange)
        subscribeRealtime(liveTopics.climbers, onClimberChange)
        subscribeRealtime(liveTopics.settings, onSettings)
        subscribeRealtime(liveTopics.followedTicks, refreshFollowsSoon)
    })

    return { provide: { realtimeCache: { applyRating, revertRating } } }
})
