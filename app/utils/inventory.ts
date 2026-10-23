export interface InventoryRoute {
    id: string
    name?: string | null
    location?: string | null
    anchor_point?: number | null
    archived?: boolean
    permanent?: boolean
}

export interface InventorySession {
    location: string | null
    ids: string[]
}

export const INVENTORY_STORAGE_KEY = 'inventory-scanned-route-ids'
export const INVENTORY_SESSION_VERSION = 3

function emptySession(): InventorySession {
    return { location: null, ids: [] }
}

function validIds(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.filter(
        (entry): entry is string =>
            typeof entry === 'string' && entry.length > 0,
    )
}

export function loadSession(gymId: string): InventorySession {
    if (typeof localStorage === 'undefined') return emptySession()

    const raw = localStorage.getItem(INVENTORY_STORAGE_KEY)
    if (!raw) return emptySession()

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return emptySession()
    }

    if (Array.isArray(parsed)) {
        return { location: null, ids: validIds(parsed) }
    }

    if (!parsed || typeof parsed !== 'object') return emptySession()

    const record = parsed as Record<string, unknown>
    // Another gym's session stays stored untouched until this gym saves its own.
    if (typeof record.gym === 'string' && record.gym && record.gym !== gymId)
        return emptySession()
    return {
        location:
            record.v === INVENTORY_SESSION_VERSION &&
            typeof record.location === 'string' &&
            record.location.length > 0
                ? record.location
                : null,
        ids: validIds(record.ids),
    }
}

export function persistSession(gymId: string, session: InventorySession): void {
    if (typeof localStorage === 'undefined') return

    if (session.ids.length === 0 && !session.location) {
        clearSession(gymId)
        return
    }

    localStorage.setItem(
        INVENTORY_STORAGE_KEY,
        JSON.stringify({
            v: INVENTORY_SESSION_VERSION,
            gym: gymId || undefined,
            location: session.location,
            ids: session.ids,
        }),
    )
}

export function clearSession(gymId: string): void {
    if (typeof localStorage === 'undefined') return
    const storedGym = loadSessionGym()
    if (storedGym && storedGym !== gymId) return
    localStorage.removeItem(INVENTORY_STORAGE_KEY)
}

function loadSessionGym(): string | null {
    try {
        const record = JSON.parse(
            localStorage.getItem(INVENTORY_STORAGE_KEY) ?? 'null',
        ) as Record<string, unknown> | null
        return typeof record?.gym === 'string' && record.gym ? record.gym : null
    } catch {
        return null
    }
}

export function scopedRoutes<T extends InventoryRoute>(
    routes: T[],
    location: string | null,
): T[] {
    if (!location) return []
    return routes.filter(
        (route) => route.archived !== true && route.location === location,
    )
}

export function missingRoutes<T extends InventoryRoute>(
    routes: T[],
    scannedIds: string[],
    location: string | null,
): T[] {
    const scanned = new Set(scannedIds)
    return sortByAnchor(
        scopedRoutes(routes, location).filter(
            (route) => !scanned.has(route.id),
        ),
    )
}

export function sortByAnchor<T extends InventoryRoute>(routes: T[]): T[] {
    return [...routes].sort((a, b) => {
        const anchorA =
            typeof a.anchor_point === 'number' ? a.anchor_point : null
        const anchorB =
            typeof b.anchor_point === 'number' ? b.anchor_point : null

        if (anchorA !== anchorB) {
            if (anchorA === null) return 1
            if (anchorB === null) return -1
            return anchorA - anchorB
        }
        return (a.name || '').localeCompare(b.name || '')
    })
}

export function countUnlocated(routes: InventoryRoute[]): number {
    return routes.filter((route) => route.archived !== true && !route.location)
        .length
}

export function extractRouteId(value: unknown): string | null {
    if (!value) return null

    const trimmed = String(value).trim()

    try {
        const id = new URL(trimmed).searchParams.get('id')
        if (id) return id
    } catch {}

    const queryStart = trimmed.indexOf('?')
    if (queryStart !== -1) {
        const id = new URLSearchParams(trimmed.slice(queryStart + 1)).get('id')
        if (id) return id
    }

    if (/^[a-z0-9]{10,}$/i.test(trimmed)) return trimmed

    return null
}

export const removableRouteIds = (
    routes: { id: string; permanent?: boolean | null }[],
) => routes.filter((route) => !route.permanent).map((route) => route.id)
