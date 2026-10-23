import { describe, it, expect, beforeEach } from 'vitest'
import {
    INVENTORY_SESSION_VERSION,
    INVENTORY_STORAGE_KEY,
    clearSession,
    countUnlocated,
    extractRouteId,
    loadSession,
    missingRoutes,
    persistSession,
    removableRouteIds,
    scopedRoutes,
    sortByAnchor,
    type InventoryRoute,
} from '~/utils/inventory'

beforeEach(() => {
    localStorage.clear()
})

const route = (
    id: string,
    overrides: Partial<InventoryRoute> = {},
): InventoryRoute => ({ id, name: id, location: 'loc-main', ...overrides })

describe('loadSession', () => {
    const stored = (gyms: Record<string, unknown>) =>
        localStorage.setItem(
            INVENTORY_STORAGE_KEY,
            JSON.stringify({ v: INVENTORY_SESSION_VERSION, gyms }),
        )

    it('returns an empty session when nothing is stored', () => {
        expect(loadSession('g1')).toEqual({ location: null, ids: [] })
    })

    it('reads the session of the given gym only', () => {
        stored({
            g1: { location: 'loc-main', ids: ['abc', 'def'] },
            g2: { location: 'loc-other', ids: ['xyz'] },
        })
        expect(loadSession('g1')).toEqual({
            location: 'loc-main',
            ids: ['abc', 'def'],
        })
        expect(loadSession('g3')).toEqual({ location: null, ids: [] })
    })

    it('keeps ids but drops the location of an older session version', () => {
        localStorage.setItem(
            INVENTORY_STORAGE_KEY,
            JSON.stringify({ v: 3, location: 'Hall A', ids: ['abc'] }),
        )
        expect(loadSession('g1')).toEqual({ location: null, ids: ['abc'] })
    })

    it('migrates a legacy v1 array to an unscoped session', () => {
        localStorage.setItem(
            INVENTORY_STORAGE_KEY,
            JSON.stringify(['abc', 'def']),
        )
        expect(loadSession('g1')).toEqual({
            location: null,
            ids: ['abc', 'def'],
        })
    })

    it('drops non-string and empty ids', () => {
        stored({
            g1: { location: 'loc-main', ids: ['abc', 42, null, '', 'def'] },
        })
        expect(loadSession('g1').ids).toEqual(['abc', 'def'])
    })

    it('treats a blank stored location as unscoped', () => {
        stored({ g1: { location: '', ids: ['abc'] } })
        expect(loadSession('g1').location).toBeNull()
    })

    it('returns an empty session for invalid JSON', () => {
        localStorage.setItem(INVENTORY_STORAGE_KEY, 'not-valid-json')
        expect(loadSession('g1')).toEqual({ location: null, ids: [] })
    })

    it('returns an empty session for an unexpected shape', () => {
        localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(42))
        expect(loadSession('g1')).toEqual({ location: null, ids: [] })
    })
})

describe('persistSession', () => {
    it('round-trips through loadSession', () => {
        persistSession('g1', { location: 'loc-other', ids: ['abc'] })
        expect(loadSession('g1')).toEqual({
            location: 'loc-other',
            ids: ['abc'],
        })
    })

    it('keeps the sessions of other gyms', () => {
        persistSession('g1', { location: 'loc-main', ids: ['abc'] })
        persistSession('g2', { location: 'loc-other', ids: [] })
        persistSession('g2', { location: null, ids: [] })
        expect(
            JSON.parse(localStorage.getItem(INVENTORY_STORAGE_KEY)!),
        ).toEqual({
            v: INVENTORY_SESSION_VERSION,
            gyms: { g1: { location: 'loc-main', ids: ['abc'] } },
        })
    })

    it('upgrades a legacy session once a location is chosen', () => {
        localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(['abc']))
        const restored = loadSession('g1')
        persistSession('g1', { ...restored, location: 'loc-main' })
        expect(loadSession('g1')).toEqual({
            location: 'loc-main',
            ids: ['abc'],
        })
    })

    it('removes the key once no gym has a session', () => {
        persistSession('g1', { location: 'loc-main', ids: ['abc'] })
        persistSession('g1', { location: null, ids: [] })
        expect(localStorage.getItem(INVENTORY_STORAGE_KEY)).toBeNull()
    })

    it('keeps a chosen location with no scans yet', () => {
        persistSession('g1', { location: 'loc-main', ids: [] })
        expect(loadSession('g1')).toEqual({ location: 'loc-main', ids: [] })
    })
})

describe('clearSession', () => {
    it('removes only the given gym session', () => {
        persistSession('g1', { location: 'loc-main', ids: ['abc'] })
        persistSession('g2', { location: 'loc-other', ids: ['xyz'] })
        clearSession('g1')
        expect(loadSession('g1')).toEqual({ location: null, ids: [] })
        expect(loadSession('g2').ids).toEqual(['xyz'])
        clearSession('g2')
        expect(localStorage.getItem(INVENTORY_STORAGE_KEY)).toBeNull()
    })
})

describe('scopedRoutes', () => {
    const routes = [
        route('a'),
        route('b', { location: 'loc-other' }),
        route('c', { archived: true }),
        route('d', { location: null }),
    ]

    it('keeps only active routes at the given location', () => {
        expect(scopedRoutes(routes, 'loc-main').map((r) => r.id)).toEqual(['a'])
    })

    it('returns nothing without a location, so nothing can be archived', () => {
        expect(scopedRoutes(routes, null)).toEqual([])
    })
})

describe('missingRoutes', () => {
    const routes = [
        route('a', { anchor_point: 2 }),
        route('b', { anchor_point: 1 }),
        route('other', { location: 'loc-other', anchor_point: 1 }),
    ]

    it('excludes scanned routes', () => {
        expect(
            missingRoutes(routes, ['b'], 'loc-main').map((r) => r.id),
        ).toEqual(['a'])
    })

    it('never reaches across locations', () => {
        expect(missingRoutes(routes, [], 'loc-main').map((r) => r.id)).toEqual([
            'b',
            'a',
        ])
    })

    it('is empty for an unscoped session', () => {
        expect(missingRoutes(routes, [], null)).toEqual([])
    })
})

describe('sortByAnchor', () => {
    it('orders by anchor point, unnumbered last, then by name', () => {
        const sorted = sortByAnchor([
            route('z', { anchor_point: null, name: 'z' }),
            route('b', { anchor_point: 5, name: 'b' }),
            route('a', { anchor_point: null, name: 'a' }),
            route('c', { anchor_point: 1, name: 'c' }),
        ])
        expect(sorted.map((r) => r.id)).toEqual(['c', 'b', 'a', 'z'])
    })

    it('does not mutate its input', () => {
        const input = [
            route('b', { anchor_point: 2 }),
            route('a', { anchor_point: 1 }),
        ]
        sortByAnchor(input)
        expect(input.map((r) => r.id)).toEqual(['b', 'a'])
    })
})

describe('countUnlocated', () => {
    it('counts active routes with no location', () => {
        expect(
            countUnlocated([
                route('a'),
                route('b', { location: null }),
                route('c', { location: '' }),
                route('d', { location: null, archived: true }),
            ]),
        ).toBe(2)
    })
})

describe('extractRouteId', () => {
    it('reads the id from a printed label URL', () => {
        expect(
            extractRouteId('https://verti.example/route?id=abc123def4567'),
        ).toBe('abc123def4567')
    })

    it('reads the id from a relative URL', () => {
        expect(extractRouteId('/route?id=abc123def4567')).toBe('abc123def4567')
    })

    it('accepts a bare record id', () => {
        expect(extractRouteId('abc123def456789')).toBe('abc123def456789')
    })

    it('trims surrounding whitespace', () => {
        expect(extractRouteId('  abc123def456789  ')).toBe('abc123def456789')
    })

    it('rejects an unrelated URL with no id', () => {
        expect(extractRouteId('https://verti.example/route')).toBeNull()
    })

    it('rejects a short or non-id string', () => {
        expect(extractRouteId('hello')).toBeNull()
        expect(extractRouteId('not an id!')).toBeNull()
    })

    it('rejects empty input', () => {
        expect(extractRouteId('')).toBeNull()
        expect(extractRouteId(null)).toBeNull()
        expect(extractRouteId(undefined)).toBeNull()
    })
})

describe('removableRouteIds', () => {
    it('leaves permanent routes out', () => {
        expect(
            removableRouteIds([
                { id: 'a' },
                { id: 'arete', permanent: true },
                { id: 'b', permanent: false },
            ]),
        ).toEqual(['a', 'b'])
    })
})
