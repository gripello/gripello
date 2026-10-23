import type { TickRecord } from '~/types/models'
import { parseDate } from '#shared/utils/formatting'
import { tickDay } from '#shared/utils/ticks'

export const TICKS_DB = 'gripello-ticks'

export interface TickOutboxOp {
    op: 'create' | 'update' | 'delete'
    id: string
    user?: string
    record?: TickRecord
    queued: string
    failed?: string
    serverErrors?: number
}

export const MAX_SERVER_ERRORS = 5

export function isServerError(error: unknown) {
    return ((error as { status?: number } | null)?.status ?? 0) >= 500
}

// A row the server keeps failing on must not hold back the ticks queued after it.
export function countServerError(op: TickOutboxOp): TickOutboxOp {
    return { ...op, serverErrors: (op.serverErrors ?? 0) + 1 }
}

export function serverGaveUp(op: TickOutboxOp) {
    return (op.serverErrors ?? 0) >= MAX_SERVER_ERRORS
}

export type PendingTick<T extends TickRecord = TickRecord> = T & {
    pending?: boolean
    syncFailed?: string
}

export function enqueueTickOp(
    queue: TickOutboxOp[],
    op: TickOutboxOp,
): TickOutboxOp[] {
    const queuedCreate = queue.find(
        (entry) => entry.op === 'create' && entry.id === op.id,
    )
    if (op.op === 'delete' && queuedCreate)
        return queue.filter((entry) => entry !== queuedCreate)
    if (op.op === 'update' && queuedCreate)
        return queue.map((entry) =>
            entry === queuedCreate
                ? {
                      ...entry,
                      record: {
                          ...entry.record!,
                          ...updatableFields(op.record),
                      },
                      failed: undefined,
                      serverErrors: undefined,
                  }
                : entry,
        )
    return [...queue.filter((entry) => entry.id !== op.id), op]
}

export function opsOfUser(queue: TickOutboxOp[], userId: string | undefined) {
    return userId ? queue.filter((entry) => entry.user === userId) : []
}

export function applyTickOutbox<T extends TickRecord>(
    ticks: T[],
    queue: TickOutboxOp[],
    userId: string | undefined,
): PendingTick<T>[] {
    const ownOps = opsOfUser(queue, userId)
    const deleted = new Set(
        ownOps
            .filter((entry) => entry.op === 'delete')
            .map((entry) => entry.id),
    )
    const updated = new Map(
        ownOps
            .filter((entry) => entry.op === 'update' && entry.record)
            .map((entry) => [entry.id, entry]),
    )
    const known = new Set(ticks.map((tick) => tick.id))
    const created = ownOps
        .filter(
            (entry): entry is TickOutboxOp & { record: TickRecord } =>
                entry.op === 'create' && !!entry.record && !known.has(entry.id),
        )
        .map((entry) => ({
            ...(entry.record as T),
            pending: true,
            syncFailed: entry.failed,
        }))
    const kept = ticks
        .filter((tick) => !deleted.has(tick.id))
        .map((tick) => {
            const update = updated.get(tick.id)
            return update
                ? {
                      ...tick,
                      ...(update.record as Partial<T>),
                      pending: true,
                      syncFailed: update.failed,
                  }
                : tick
        })
    return [...created, ...kept].sort(
        (a, b) =>
            b.date.localeCompare(a.date) ||
            (b.created ?? '').localeCompare(a.created ?? ''),
    )
}

const isoTimestamp = <T extends string | null | undefined>(value: T) =>
    ((value && parseDate(value)?.toISOString()) || value) as T

// Ticks queued or cached by older clients carry "YYYY-MM-DD 12:00:00.000Z" days and space-separated timestamps.
export function currentTickRecord<T extends TickRecord>(record: T): T {
    return {
        ...record,
        date: tickDay(record.date),
        created: isoTimestamp(record.created),
        updated: isoTimestamp(record.updated),
    }
}

export function currentTickOp(op: TickOutboxOp): TickOutboxOp {
    return {
        ...op,
        record: op.record && currentTickRecord(op.record),
        queued: isoTimestamp(op.queued),
    }
}

const DUPLICATE_ID = 'validation_pk_invalid'

export function isAlreadyApplied(op: TickOutboxOp, error: unknown) {
    const { status, response } =
        (error as {
            status?: number
            response?: { data?: { id?: { code?: string } } }
        } | null) ?? {}
    if (op.op !== 'create') return status === 404
    return status === 400 && response?.data?.id?.code === DUPLICATE_ID
}

export function replayFailure(error: unknown) {
    const { message } = (error as { message?: string } | null) ?? {}
    return message || 'Sync failed'
}

export function updatableFields(record: TickRecord | undefined) {
    if (!record) return {}
    const { type, attempts, date, note } = record
    return { type, attempts, date, note }
}

// Ops queued while this one was in flight stay; a create they folded into becomes the follow-up edit or delete.
export function settleReplayedOp(
    queue: TickOutboxOp[],
    op: TickOutboxOp,
): TickOutboxOp[] {
    const current = queue.find((entry) => entry.id === op.id)
    if (current === op) return queue.filter((entry) => entry !== op)
    if (op.op !== 'create') return queue
    if (!current)
        return [
            ...queue,
            {
                op: 'delete',
                id: op.id,
                user: op.user,
                queued: new Date().toISOString(),
            },
        ]
    if (current.op !== 'create') return queue
    return queue.map((entry) =>
        entry === current
            ? {
                  op: 'update',
                  id: op.id,
                  user: op.user,
                  record: current.record,
                  queued: current.queued,
              }
            : entry,
    )
}
