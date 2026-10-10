import type { TickRecord } from '~/types/models'
import {
    createTick as postTick,
    deleteTick as removeTick,
    updateTick as patchTick,
} from '~/api/ticks'
import { newRecordId } from '~/utils/realtimeCache'
import {
    enqueueTickOp,
    isAlreadyApplied,
    isOfflineError,
    opsOfUser,
    replayFailure,
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

export function useTickOutbox() {
    const authStore = useAuthStore()
    const queue = useState<TickOutboxOp[]>('tick-outbox', () => [])
    const loaded = useState('tick-outbox-loaded', () => false)
    const available = import.meta.client && 'indexedDB' in globalThis

    async function load() {
        if (!available || loaded.value) return
        queue.value = await readAll<TickOutboxOp>('outbox').catch(() => [])
        loaded.value = true
    }

    function persist() {
        if (available) void replaceAll('outbox', queue.value).catch(() => {})
    }

    function enqueue(op: TickOutboxOp) {
        queue.value = enqueueTickOp(queue.value, op)
        persist()
        void navigator.storage?.persist?.().catch(() => {})
    }

    async function createTick(fields: Omit<TickRecord, 'id'>) {
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

    async function flush() {
        await load()
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
                    queue.value = queue.value.map((entry) =>
                        entry === op
                            ? { ...entry, failed: replayFailure(error) }
                            : entry,
                    )
                    continue
                }
            }
            queue.value = queue.value.filter((entry) => entry.id !== op.id)
        }
        persist()
        await refreshNuxtData(['logbook', 'ticked-routes'])
    }

    function cacheTicks<T extends TickRecord>(ticks: T[]) {
        if (available) void replaceAll('ticks', ticks).catch(() => {})
    }

    function cachedTicks<T extends TickRecord>() {
        return available ? readAll<T>('ticks').catch(() => []) : []
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
