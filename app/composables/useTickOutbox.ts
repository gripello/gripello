import { isOfflineError } from '~/utils/errors'
import type { TickRecord } from '~/types/models'
import {
    createTick as postTick,
    deleteTick as removeTick,
    updateTick as patchTick,
} from '~/api/ticks'
import { newRecordId } from '~/utils/realtimeCache'
import {
    currentTickOp,
    currentTickRecord,
    enqueueTickOp,
    isAlreadyApplied,
    opsOfUser,
    replayFailure,
    settleReplayedOp,
    updatableFields,
    TICKS_DB,
    type PendingTick,
    type TickOutboxOp,
} from '~/utils/tickOutbox'
const STORES = ['outbox', 'ticks'] as const
type StoreName = (typeof STORES)[number]

function openDb() {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(TICKS_DB, 1)
        request.onupgradeneeded = () => {
            for (const name of STORES)
                if (!request.result.objectStoreNames.contains(name))
                    request.result.createObjectStore(name, { keyPath: 'id' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

async function withStore<T>(
    name: StoreName,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
    const db = await openDb()
    return new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(name, mode)
        const request = run(tx.objectStore(name))
        tx.oncomplete = () => {
            db.close()
            resolve(request ? request.result : undefined)
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
    })
}

function readAll<T>(name: StoreName) {
    return withStore<T[]>(name, 'readonly', (store) => store.getAll()).then(
        (rows) => rows ?? [],
    )
}

function replaceAll<T extends { id: string }>(name: StoreName, rows: T[]) {
    const plainRows: T[] = JSON.parse(JSON.stringify(rows))
    return withStore(name, 'readwrite', (store) => {
        store.clear()
        for (const row of plainRows) store.put(row)
    })
}

// Per-row writes, so tabs sharing the outbox don't erase each other's ops.
function writeRows<T extends { id: string }>(
    name: StoreName,
    puts: T[],
    deletes: string[],
) {
    const plainRows: T[] = JSON.parse(JSON.stringify(puts))
    return withStore(name, 'readwrite', (store) => {
        for (const id of deletes) store.delete(id)
        for (const row of plainRows) store.put(row)
    })
}

let outboxWrites: Promise<unknown> = Promise.resolve()
let flushing: Promise<void> | null = null
let flushAgain = false
const deletedWhileQueued = new Set<string>()

function withOutboxLock(run: () => Promise<void>) {
    const locks = globalThis.navigator?.locks
    return locks?.request ? locks.request('gripello-tick-outbox', run) : run()
}

export function useTickOutbox() {
    const authStore = useAuthStore()
    const queue = useState<TickOutboxOp[]>('tick-outbox', () => [])
    const loaded = useState('tick-outbox-loaded', () => false)
    const available = import.meta.client && 'indexedDB' in globalThis

    async function settledWrites() {
        let pending: Promise<unknown>
        do {
            pending = outboxWrites
            await pending
        } while (pending !== outboxWrites)
    }

    async function reload() {
        let pending: Promise<unknown>
        let rows: TickOutboxOp[] | null
        do {
            pending = outboxWrites
            await pending
            rows = await readAll<TickOutboxOp>('outbox').catch(() => null)
        } while (pending !== outboxWrites)
        if (rows) queue.value = rows.map(currentTickOp)
        loaded.value = true
    }

    // another tab may have edited or deleted this row while it was being sent
    async function withStoredRow(op: TickOutboxOp) {
        let pending: Promise<unknown>
        let stored: TickOutboxOp | undefined | null
        do {
            pending = outboxWrites
            await pending
            stored = await withStore<TickOutboxOp>(
                'outbox',
                'readonly',
                (store) => store.get(op.id),
            ).catch(() => null)
        } while (pending !== outboxWrites)
        if (stored === null) return queue.value
        if (stored) stored = currentTickOp(stored)
        const current =
            stored && JSON.stringify(stored) === JSON.stringify(op)
                ? op
                : stored
        const others = queue.value.filter((entry) => entry.id !== op.id)
        return current ? [...others, current] : others
    }

    async function load() {
        if (!available || loaded.value) return
        await reload()
    }

    function setQueue(next: TickOutboxOp[]) {
        const previous = new Map(queue.value.map((entry) => [entry.id, entry]))
        queue.value = next
        if (!available) return
        const kept = new Set(next.map((entry) => entry.id))
        const puts = next.filter((entry) => previous.get(entry.id) !== entry)
        const deletes = [...previous.keys()].filter((id) => !kept.has(id))
        if (!puts.length && !deletes.length) return
        outboxWrites = outboxWrites
            .then(() => writeRows('outbox', puts, deletes))
            .catch(() => {})
    }

    function enqueue(op: TickOutboxOp) {
        setQueue(enqueueTickOp(queue.value, op))
        void navigator.storage?.persist?.().catch(() => {})
    }

    async function createTick(
        fields: Omit<TickRecord, 'id' | 'created' | 'updated'>,
    ) {
        const now = new Date().toISOString()
        const record: TickRecord = {
            ...fields,
            id: newRecordId(),
            created: now,
            updated: now,
        }
        try {
            return {
                tick: await postTick(record),
                queued: false,
            }
        } catch (error) {
            if (!available || !isOfflineError(error)) throw error
            enqueue({
                op: 'create',
                id: record.id,
                user: record.user,
                record,
                queued: now,
            })
            return { tick: record, queued: true }
        }
    }

    async function updateTick(
        { pending: _pending, syncFailed: _syncFailed, ...tick }: PendingTick,
        fields: Partial<TickRecord>,
    ) {
        const record: TickRecord = {
            ...tick,
            ...fields,
            updated: new Date().toISOString(),
        }
        const queued = () => {
            enqueue({
                op: 'update',
                id: tick.id,
                user: tick.user,
                record,
                queued: record.updated!,
            })
            return { tick: record, queued: true }
        }
        if (queue.value.some((op) => op.op === 'create' && op.id === tick.id))
            return queued()
        try {
            return {
                tick: await patchTick(tick.id, fields),
                queued: false,
            }
        } catch (error) {
            if (!available || !isOfflineError(error)) throw error
            return queued()
        }
    }

    async function deleteTick(id: string) {
        if (queue.value.some((op) => op.op === 'create' && op.id === id)) {
            deletedWhileQueued.add(id)
            enqueue({ op: 'delete', id, queued: new Date().toISOString() })
            return { queued: false }
        }
        try {
            await removeTick(id)
            return { queued: false }
        } catch (error) {
            if (!available || !isOfflineError(error)) throw error
            enqueue({
                op: 'delete',
                id,
                user: authStore.record?.id,
                queued: new Date().toISOString(),
            })
            return { queued: true }
        }
    }

    // one replay at a time: in this tab, and across tabs where Web Locks exist
    function flush(): Promise<void> {
        if (flushing) {
            flushAgain = true
            return flushing
        }
        flushing = (async () => {
            do {
                flushAgain = false
                await withOutboxLock(replay)
            } while (flushAgain)
        })().finally(() => (flushing = null))
        return flushing
    }

    async function replay() {
        if (!available) return
        await reload()
        if (!authStore.isValid) return
        const replayable = opsOfUser(queue.value, authStore.record?.id).filter(
            (op) => !op.failed,
        )
        if (!replayable.length) return
        for (const op of replayable) {
            try {
                if (op.op === 'create') await postTick(op.record!)
                else if (op.op === 'update')
                    await patchTick(op.id, updatableFields(op.record))
                else await removeTick(op.id)
            } catch (error) {
                if (isOfflineError(error)) break
                if (op.op !== 'delete' && !isAlreadyApplied(op, error)) {
                    console.error('Replaying tick failed:', error)
                    setQueue(
                        queue.value.map((entry) =>
                            entry === op
                                ? { ...entry, failed: replayFailure(error) }
                                : entry,
                        ),
                    )
                    continue
                }
            }
            const stored = await withStoredRow(op)
            const deletedHere = deletedWhileQueued.delete(op.id)
            // without Web Locks a vanished row may be another tab's settle, not a delete
            const settledElsewhere =
                !globalThis.navigator?.locks &&
                !deletedHere &&
                !stored.some((entry) => entry.id === op.id)
            const next = settledElsewhere
                ? stored
                : settleReplayedOp(stored, op)
            if (next.some((entry) => entry.id === op.id)) flushAgain = true
            setQueue(next)
        }
        // the lock must outlast the writes, or the next tab replays what was just sent
        await settledWrites()
        await refreshNuxtData(['logbook', 'ticked-routes'])
    }

    function cacheTicks<T extends TickRecord>(ticks: T[]) {
        if (available) void replaceAll('ticks', ticks).catch(() => {})
    }

    function cachedTicks<T extends TickRecord>() {
        return available
            ? readAll<T>('ticks').then(
                  (ticks) => ticks.map(currentTickRecord),
                  () => [],
              )
            : []
    }

    async function clearCachedTicks() {
        if (available) await replaceAll('ticks', []).catch(() => {})
    }

    return {
        queue,
        load,
        createTick,
        updateTick,
        deleteTick,
        flush,
        cacheTicks,
        cachedTicks,
        clearCachedTicks,
    }
}
