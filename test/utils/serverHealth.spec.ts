import { describe, expect, it } from 'vitest'
import type { ServerReplica } from '~/api/platform'
import { issueTitle, replicaStrain } from '~/utils/serverHealth'

const healthy: ServerReplica = {
    name: 'app-1',
    version: '1.0.0',
    role: 'all',
    started: '2026-10-12T08:00:00Z',
    last_seen: '2026-10-12T09:00:00Z',
    online: true,
    realtime_clients: 10,
    memory_bytes: 1,
    goroutines: 50,
    heap_bytes: 1,
    gc_pause_ms: 0.2,
    db_conns_in_use: 2,
    db_conns_max: 20,
    db_waits: 0,
    db_wait_ms: 0,
    realtime_dropped: 0,
    bus_lag_ms: 0,
    bus_queue_max: 0,
}

describe('replicaStrain', () => {
    it('is empty for a healthy or offline replica', () => {
        expect(replicaStrain(healthy)).toEqual([])
        expect(
            replicaStrain({ ...healthy, online: false, db_wait_ms: 5000 }),
        ).toEqual([])
    })

    it('flags pool waits, a full pool, dropped events and bus lag', () => {
        expect(
            replicaStrain({
                ...healthy,
                db_wait_ms: 1500,
                db_conns_in_use: 20,
                realtime_dropped: 3,
                bus_lag_ms: 12_000,
            }),
        ).toEqual(['dbWaits', 'dbFull', 'realtimeDropped', 'busLag'])
    })
})

describe('issueTitle', () => {
    it('joins message, route and error, skipping missing parts', () => {
        expect(
            issueTitle({
                message: 'request failed',
                sample: { route: 'GET /api/routes/{id}', error: 'boom' },
            }),
        ).toBe('request failed · GET /api/routes/{id} · boom')
        expect(issueTitle({ message: 'slow query' })).toBe('slow query')
    })
})
