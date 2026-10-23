import type { RouteQuery } from '~/api/routes'
import { routeMatchesQuery } from '~/utils/routeSearch'
import type {
    OpenRouteDefectRecord,
    RatingRecord,
    RouteRecord,
    WallRecord,
} from '~/types/models'

export const cacheKeys = {
    overviewRoutes: 'overview-routes',
    overviewWalls: 'overview-walls',
    mapRoutes: 'map-routes',
    mapWalls: 'map-walls',
    keyLocations: 'live-key-locations',
    keyQueries: 'live-key-queries',
    mapMatching: 'map-matching',
    routesList: 'routes-list',
    route: (routeId: string) => `route:${routeId}`,
    ratings: (routeId: string) => `ratings:${routeId}`,
    ratingsSheet: (routeId: string) => `ratings-sheet:${routeId}`,
    betas: (routeId: string) => `beta-videos:${routeId}`,
    unplacedRoutes: 'unplaced-routes',
    locations: 'locations',
    gymWalls: (scope: string) => `${scope}-walls`,
    placementRoutes: 'placement-routes',
    mapEditorRoutes: 'map-editor-routes',
    routeFilterWalls: (scope: string) => `${scope}-filter-walls`,
    openDefects: 'open-route-defects',
    routeDefects: (routeId: string) => `route-defects:${routeId}`,
    tickedRoutes: 'ticked-routes',
    logbook: 'logbook',
    seasons: 'leaderboard-seasons',
    settings: 'settings',
    leaderboard: 'leaderboard',
    achievements: (userId: string) => `achievements:${userId}`,
    follows: 'follows',
    blocks: 'blocks',
    friendsFeed: 'friends-feed',
    communityFeed: 'community-feed',
}

export const isFollowKey = (key: string) =>
    key === cacheKeys.follows ||
    key === cacheKeys.friendsFeed ||
    key === cacheKeys.communityFeed ||
    key.startsWith('climber:') ||
    key.startsWith('climber-ticks:')

export const isOwnTickKey = (key: string) =>
    key === cacheKeys.tickedRoutes ||
    key === cacheKeys.logbook ||
    key.startsWith('climber-compare-mine:')

// Keys that show a climber's name or avatar: lookups by id, the profile, and authors of reviews and betas.
export function showsClimber(key: string, data: unknown, climberId: string) {
    const ids = keySuffix(key, 'climbers:')
    if (ids !== undefined) return ids.split(',').includes(climberId)
    if (key === `climber:${climberId}`) return true
    if (
        ratingsRouteId(key) === undefined &&
        !key.startsWith(cacheKeys.betas(''))
    )
        return false
    return (
        Array.isArray(data) &&
        data.some(
            (item: { author?: { id?: string } }) =>
                item.author?.id === climberId,
        )
    )
}

// climber-ticks:* reads the follow state and the profile while it loads
export function splitFollowRefresh(keys: string[]) {
    const first = keys.filter(
        (key) => key === cacheKeys.follows || key.startsWith('climber:'),
    )
    return [first, keys.filter((key) => !first.includes(key))] as const
}

export type GymChangeCollection =
    'routes' | 'walls' | 'locations' | 'ratings' | 'beta_videos' | 'seasons'

export interface GymChange<T = Record<string, unknown>> {
    collection: GymChangeCollection
    action: 'create' | 'update' | 'delete'
    record: T
}

export interface OpenDefectsChange {
    gym: string
    routes: string[]
    defects: OpenRouteDefectRecord[]
}

export type KeyLocations = Record<string, string>
export type KeyQueries = Record<string, RouteQuery | null>

function inLocation<T extends { location?: string | null }>(
    locationId: string | undefined,
) {
    return (record: T) => !!locationId && record.location === locationId
}

export type InScope<T> = (record: T) => boolean | null
export interface ListPage<T> {
    items: T[]
    totalItems: number
}

export type RowsData<T> = T[] | ListPage<T>
export type RatingLedger = Map<string, RatingRecord | null>
export interface RatingChange {
    added: RatingRecord | null
    removed: RatingRecord | null
}

export const NEW_ROUTE_SCORE = { average_rating: null, ratings_count: 0 }

function keySuffix(key: string, prefix: string) {
    return key.startsWith(prefix) ? key.slice(prefix.length) : undefined
}

// The paged list never inserts (a new row may belong on another page); rows that stop matching its query leave.
export function routeRowsScope(
    key: string,
    keyLocations: KeyLocations = {},
    keyQueries: KeyQueries = {},
): InScope<RouteRecord> | undefined {
    if (key === cacheKeys.overviewRoutes) return () => true
    if (key === cacheKeys.routesList) {
        const query = keyQueries[key]
        return query
            ? (route) => (routeMatchesQuery(route, query) ? null : false)
            : () => null
    }
    if (key.endsWith('-routes') && key in keyLocations)
        return inLocation(keyLocations[key])
}

export function wallsScope(
    key: string,
    keyLocations: KeyLocations = {},
): InScope<WallRecord> | undefined {
    if (key === cacheKeys.overviewWalls) return () => true
    if (key.endsWith('-walls') && key in keyLocations)
        return inLocation(keyLocations[key])
}

export function ratingsRouteId(key: string) {
    return (
        keySuffix(key, cacheKeys.ratings('')) ??
        keySuffix(key, cacheKeys.ratingsSheet(''))
    )
}

export function detailRouteId(key: string) {
    return keySuffix(key, cacheKeys.route(''))
}

export function defectsScope(
    key: string,
): ((routeId: string) => boolean) | undefined {
    if (key === cacheKeys.openDefects) return () => true
    const routeId = keySuffix(key, cacheKeys.routeDefects(''))
    if (routeId) return (candidate) => candidate === routeId
}

export function replaceRouteDefects<
    T extends Pick<OpenRouteDefectRecord, 'route'>,
>(
    defects: T[],
    change: { gym: string; routes: string[]; defects: T[] },
    inScope: (routeId: string) => boolean,
    gymId: string,
): T[] {
    if (!gymId || change.gym !== gymId) return defects
    const routes = change.routes.filter(inScope)
    if (!routes.length) return defects
    return [
        ...defects.filter((defect) => !routes.includes(defect.route)),
        ...change.defects.filter((defect) => routes.includes(defect.route)),
    ]
}

const RESYNCED_KEYS: string[] = [
    cacheKeys.unplacedRoutes,
    cacheKeys.tickedRoutes,
    cacheKeys.logbook,
    cacheKeys.locations,
    cacheKeys.blocks,
    cacheKeys.mapMatching,
]

export function isLiveKey(key: string, keyLocations: KeyLocations = {}) {
    return (
        RESYNCED_KEYS.includes(key) ||
        key.startsWith('climbers:') ||
        key.startsWith(cacheKeys.betas('')) ||
        isFollowKey(key) ||
        !!defectsScope(key) ||
        !!routeRowsScope(key, keyLocations) ||
        !!wallsScope(key, keyLocations) ||
        ratingsRouteId(key) !== undefined ||
        detailRouteId(key) !== undefined
    )
}

export function rowsOf<T>(data: RowsData<T>) {
    return Array.isArray(data) ? data : data.items
}

export function mapRows<T>(
    data: RowsData<T>,
    patch: (rows: T[]) => T[],
): RowsData<T> {
    if (Array.isArray(data)) return patch(data)
    const items = patch(data.items)
    if (items === data.items) return data
    return {
        ...data,
        items,
        totalItems: data.totalItems + items.length - data.items.length,
    }
}

export type ExpandField = 'wall' | 'location'
type Expandable = { id: string; expand?: Record<string, unknown> }

export function patchExpanded<T extends Expandable>(
    rows: T[],
    field: ExpandField,
    record: { id: string },
): T[] {
    let changed = false
    const next = rows.map((row) => {
        const current = row.expand?.[field] as { id?: string } | undefined
        if (current?.id !== record.id) return row
        changed = true
        return {
            ...row,
            expand: { ...row.expand, [field]: { ...current, ...record } },
        }
    })
    return changed ? next : rows
}

export function relinkExpanded<
    T extends Expandable & Partial<Record<ExpandField, string | null>>,
>(
    row: T,
    field: ExpandField,
    known: (id: string) => { id: string } | undefined,
): T {
    const current = row.expand?.[field] as { id?: string } | undefined
    const id = row[field]
    if (!current || current.id === id) return row
    const { [field]: _stale, ...rest } = row.expand!
    const match = id ? known(id) : undefined
    return { ...row, expand: match ? { ...rest, [field]: match } : rest }
}

export function upsertById<T extends { id: string }>(
    list: T[],
    record: T,
    position: 'start' | 'end' = 'end',
): T[] {
    if (list.some((item) => item.id === record.id))
        return list.map((item) =>
            item.id === record.id ? { ...item, ...record } : item,
        )
    return position === 'start' ? [record, ...list] : [...list, record]
}

export function removeById<T extends { id: string }>(
    list: T[],
    id: string,
): T[] {
    return list.some((item) => item.id === id)
        ? list.filter((item) => item.id !== id)
        : list
}

export function patchList<T extends { id: string }>(
    list: T[],
    record: T,
    keep: boolean | null,
    insertDefaults: Partial<T> = {},
): T[] {
    if (keep === false) return removeById(list, record.id)
    if (list.some((item) => item.id === record.id))
        return upsertById(list, record)
    return keep ? [...list, { ...insertDefaults, ...record }] : list
}

function stars(rating: Pick<RatingRecord, 'rating'> | null) {
    return rating?.rating && rating.rating > 0 ? rating.rating : 0
}

type Score = Pick<RouteRecord, 'average_rating' | 'ratings_count'>

export function shiftScore(score: Score, added: number, removed = 0): Score {
    const count = Number(score.ratings_count ?? 0)
    const sum = Number(score.average_rating ?? 0) * count
    const nextCount = count + (added ? 1 : 0) - (removed ? 1 : 0)
    if (nextCount <= 0) return { average_rating: null, ratings_count: 0 }
    return {
        average_rating: (sum + added - removed) / nextCount,
        ratings_count: nextCount,
    }
}

export function applyRatingChange<T extends RouteRecord>(
    rows: T[],
    change: RatingChange,
): T[] {
    let changed = false
    const next = rows.map((row) => {
        const added =
            change.added?.route_id === row.id ? stars(change.added) : 0
        const removed =
            change.removed?.route_id === row.id ? stars(change.removed) : 0
        if (!added && !removed) return row
        changed = true
        return { ...row, ...shiftScore(row, added, removed) }
    })
    return changed ? next : rows
}

export function trackRating(
    ledger: RatingLedger,
    action: string,
    rating: RatingRecord,
    cachedPrevious?: RatingRecord,
): RatingChange | 'unknown' | null {
    if (action === 'create') {
        if (ledger.has(rating.id)) return null
        ledger.set(rating.id, rating)
        return { added: rating, removed: null }
    }
    if (action === 'delete') {
        if (ledger.get(rating.id) === null) return null
        ledger.set(rating.id, null)
        return { added: null, removed: rating }
    }
    const previous = ledger.get(rating.id) ?? cachedPrevious
    ledger.set(rating.id, rating)
    return previous ? { added: rating, removed: previous } : 'unknown'
}

export const STALE_SSR_AGE_MS = 1000

export function servedStaleFromSsrCache(ageAttribute: string | undefined) {
    return Number(ageAttribute || 0) >= STALE_SSR_AGE_MS
}

// A hidden tab runs the task once when it becomes visible again, not per burst while hidden.
export function coalesce(task: () => Promise<unknown>, delayMs = 1000) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let waitingForVisible = false
    const run = () => void task().catch(() => {})
    const runWhenVisible = () => {
        if (document.visibilityState === 'hidden') return
        document.removeEventListener('visibilitychange', runWhenVisible)
        waitingForVisible = false
        run()
    }
    const schedule = () => {
        if (timer || waitingForVisible) return
        timer = setTimeout(
            () => {
                timer = undefined
                if (document.visibilityState !== 'hidden') return run()
                waitingForVisible = true
                document.addEventListener('visibilitychange', runWhenVisible)
            },
            delayMs + Math.random() * delayMs,
        )
    }
    const cancel = () => {
        clearTimeout(timer)
        timer = undefined
        waitingForVisible = false
        document.removeEventListener('visibilitychange', runWhenVisible)
    }
    return Object.assign(schedule, { cancel })
}

// coalesce that remembers which ids changed; an id-less call asks for everything (null).
export function coalesceIds(
    task: (ids: Set<string> | null) => Promise<unknown>,
    delayMs = 1000,
) {
    let ids: Set<string> | null = new Set()
    const soon = coalesce(() => {
        const changed = ids
        ids = new Set()
        return task(changed)
    }, delayMs)
    return (id?: string) => {
        if (!id) ids = null
        else ids?.add(id)
        soon()
    }
}

export async function unlessQueryChanged<T>(
    query: () => string,
    fetch: () => Promise<T>,
    current: () => T,
): Promise<T> {
    const before = query()
    for (let attempt = 1; ; attempt++) {
        const seen = current()
        const result = await fetch()
        if (query() !== before) return current()
        // a live patch during the request is newer than its answer, so ask again
        if (current() === seen || attempt === 3) return result
    }
}

const RECORD_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function newRecordId(length = 15) {
    const bytes = crypto.getRandomValues(new Uint8Array(length))
    return Array.from(
        bytes,
        (byte) => RECORD_ID_ALPHABET[byte % RECORD_ID_ALPHABET.length],
    ).join('')
}

export function relinkRow<
    T extends Expandable & Partial<Record<ExpandField, string | null>>,
>(rows: T[], id: string, known: (id: string) => { id: string } | undefined) {
    const index = rows.findIndex((row) => row.id === id)
    if (index < 0) return rows
    const row = rows[index]!
    const relinked = relinkExpanded(
        relinkExpanded(row, 'wall', known),
        'location',
        known,
    )
    if (relinked === row) return rows
    const next = [...rows]
    next[index] = relinked
    return next
}

export interface StaffRouteUpdate<T> {
    rows: T[]
    reload: boolean
    rescore: string | null
}

// Staff tables patch what they show; a rating only rescores its route instead of reloading the page.
function expandedRecord(rows: Expandable[], id: string) {
    for (const row of rows)
        for (const field of ['wall', 'location'] as const) {
            const linked = row.expand?.[field] as { id?: string } | undefined
            if (linked?.id === id) return linked as { id: string }
        }
    return undefined
}

export function staffRouteChange<
    T extends { id: string; archived?: boolean } & Expandable &
        Partial<Record<ExpandField, string | null>>,
>(rows: T[], change: GymChange): StaffRouteUpdate<T> {
    const record = change.record as {
        id: string
        route_id?: string
        archived?: boolean
    }
    const unchanged = { rows, reload: false, rescore: null }
    switch (change.collection) {
        case 'routes': {
            const row = rows.find((item) => item.id === record.id)
            if (change.action === 'delete')
                return {
                    ...unchanged,
                    rows: removeById(rows, record.id),
                    reload: true,
                }
            if (
                change.action === 'create' ||
                !row ||
                !!row.archived !== !!record.archived
            )
                return { ...unchanged, reload: true }
            const next = relinkRow(
                upsertById(rows, record as T),
                record.id,
                (id) => expandedRecord(rows, id),
            )
            const moved = next.find((item) => item.id === record.id)!
            const unknownTarget = (['wall', 'location'] as const).some(
                (field) =>
                    !!moved[field] &&
                    !!row.expand?.[field] &&
                    !moved.expand?.[field],
            )
            return { ...unchanged, rows: next, reload: unknownTarget }
        }
        case 'walls':
            return { ...unchanged, rows: patchExpanded(rows, 'wall', record) }
        case 'locations':
            return {
                ...unchanged,
                rows: patchExpanded(rows, 'location', record),
            }
        case 'ratings':
            return {
                ...unchanged,
                rescore: rows.some((item) => item.id === record.route_id)
                    ? record.route_id!
                    : null,
            }
    }
    return unchanged
}
