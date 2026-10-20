import { describe, expect, it } from 'vitest'
import type { TickRecord } from '~/types/models'
import {
    applyTickOutbox,
    currentTickOp,
    currentTickRecord,
    enqueueTickOp,
    isAlreadyApplied,
    opsOfUser,
    replayFailure,
    settleReplayedOp,
    updatableFields,
    type TickOutboxOp,
} from '~/utils/tickOutbox'

const tick = (id: string, date: string, created = ''): TickRecord => ({
    id,
    user: 'u1',
    route: 'r1',
    type: 'top',
    attempts: 1,
    date,
    created,
})

const create = (id: string, date: string, user = 'u1'): TickOutboxOp => ({
    op: 'create',
    id,
    user,
    record: { ...tick(id, date), user },
    queued: '2026-10-03T10:00:00Z',
})
const remove = (id: string, user = 'u1'): TickOutboxOp => ({
    op: 'delete',
    id,
    user,
    queued: '2026-10-03T10:00:00Z',
})

const duplicateId = {
    status: 400,
    response: { data: { id: { code: 'validation_pk_invalid' } } },
}

describe('enqueueTickOp', () => {
    it('drops a queued create when the same tick is deleted offline', () => {
        expect(enqueueTickOp([create('a', '2026-10-01')], remove('a'))).toEqual(
            [],
        )
    })

    it('drops a failed create when it is deleted', () => {
        const failed = { ...create('a', '2026-10-01'), failed: 'nope' }
        expect(enqueueTickOp([failed], remove('a'))).toEqual([])
    })

    it('keeps a delete of a server tick and replaces duplicates by id', () => {
        const queue = enqueueTickOp(
            enqueueTickOp([], remove('srv')),
            remove('srv'),
        )
        expect(queue).toEqual([remove('srv')])
    })
})

describe('applyTickOutbox', () => {
    it('prepends pending creates, hides deletes and sorts by date', () => {
        const ticks = [tick('b', '2026-09-30'), tick('srv', '2026-09-20')]
        const queue = [create('a', '2026-10-01'), remove('srv')]
        const result = applyTickOutbox(ticks, queue, 'u1')
        expect(result.map((entry) => entry.id)).toEqual(['a', 'b'])
        expect(result[0]?.pending).toBe(true)
        expect(result[1]?.pending).toBeUndefined()
    })

    it('does not duplicate a create the server already returned', () => {
        const result = applyTickOutbox(
            [tick('a', '2026-10-01')],
            [create('a', '2026-10-01')],
            'u1',
        )
        expect(result).toHaveLength(1)
        expect(result[0]?.pending).toBeUndefined()
    })

    it("shows only the signed-in climber's queued ticks", () => {
        const queue = [
            create('mine', '2026-10-01'),
            create('theirs', '2026-10-02', 'u2'),
        ]
        expect(applyTickOutbox([], queue, 'u1').map((t) => t.id)).toEqual([
            'mine',
        ])
        expect(applyTickOutbox([], queue, undefined)).toEqual([])
    })

    it('marks a create that failed to replay', () => {
        const failed = { ...create('a', '2026-10-01'), failed: 'Route gone' }
        expect(applyTickOutbox([], [failed], 'u1')[0]?.syncFailed).toBe(
            'Route gone',
        )
    })
})

describe('opsOfUser', () => {
    it('returns nothing without a user', () => {
        expect(opsOfUser([create('a', '2026-10-01')], undefined)).toEqual([])
    })
})

describe('isAlreadyApplied', () => {
    it('treats only a duplicate id as an already replayed create', () => {
        expect(isAlreadyApplied(create('x', ''), duplicateId)).toBe(true)
        expect(
            isAlreadyApplied(create('x', ''), {
                status: 400,
                response: {
                    data: { route: { code: 'validation_missing_rel_records' } },
                },
            }),
        ).toBe(false)
        expect(isAlreadyApplied(create('x', ''), { status: 400 })).toBe(false)
        expect(isAlreadyApplied(create('x', ''), { status: 403 })).toBe(false)
    })

    it('treats a 404 delete as already replayed', () => {
        expect(isAlreadyApplied(remove('x'), { status: 404 })).toBe(true)
        expect(isAlreadyApplied(remove('x'), { status: 403 })).toBe(false)
    })
})

describe('replayFailure', () => {
    it('keeps the server message for the badge tooltip', () => {
        expect(replayFailure({ message: 'Failed to create record.' })).toBe(
            'Failed to create record.',
        )
        expect(replayFailure(null)).toBe('Sync failed')
    })
})

describe('offline tick edits', () => {
    const update = (id: string, note: string): TickOutboxOp => ({
        op: 'update',
        id,
        user: 'u1',
        record: { ...tick(id, '2026-10-01'), note, type: 'flash' },
        queued: '2026-10-03T11:00:00Z',
    })

    it('folds an edit of a queued create into the create', () => {
        const failed = { ...create('a', '2026-10-01'), failed: 'Route gone' }
        const queue = enqueueTickOp([failed], update('a', 'crux'))
        expect(queue).toHaveLength(1)
        expect(queue[0]).toMatchObject({
            op: 'create',
            failed: undefined,
            record: { note: 'crux', type: 'flash', route: 'r1' },
        })
    })

    it('keeps only the latest edit and lets a delete win', () => {
        const queue = enqueueTickOp([update('a', 'one')], update('a', 'two'))
        expect(queue.map((op) => op.record?.note)).toEqual(['two'])
        expect(enqueueTickOp(queue, remove('a')).map((op) => op.op)).toEqual([
            'delete',
        ])
    })

    it('overlays a queued edit as pending', () => {
        const [shown] = applyTickOutbox(
            [tick('a', '2026-10-01')],
            [update('a', 'crux')],
            'u1',
        )
        expect(shown).toMatchObject({
            note: 'crux',
            type: 'flash',
            pending: true,
        })
    })

    it('treats a 404 edit as already resolved', () => {
        expect(isAlreadyApplied(update('x', ''), { status: 404 })).toBe(true)
        expect(isAlreadyApplied(update('x', ''), { status: 400 })).toBe(false)
    })

    it('replays only editable fields', () => {
        expect(updatableFields(update('a', 'crux').record)).toEqual({
            type: 'flash',
            attempts: 1,
            date: '2026-10-01',
            note: 'crux',
        })
    })
})

describe('settleReplayedOp', () => {
    it('removes only the replayed entry', () => {
        const sent = create('a', '2026-10-01')
        const other = remove('b')
        expect(settleReplayedOp([sent, other], sent)).toEqual([other])
    })

    it('keeps an edit folded into the create while it was posted', () => {
        const sent = create('a', '2026-10-01')
        const edited = enqueueTickOp([sent], {
            op: 'update',
            id: 'a',
            user: 'u1',
            record: { ...tick('a', '2026-10-01'), note: 'crux' },
            queued: '2026-10-03T11:00:00Z',
        })
        expect(settleReplayedOp(edited, sent)).toEqual([
            expect.objectContaining({
                op: 'update',
                id: 'a',
                record: expect.objectContaining({ note: 'crux' }),
            }),
        ])
    })

    it('deletes a create that was removed while it was posted', () => {
        const sent = create('a', '2026-10-01')
        const queue = enqueueTickOp([sent], remove('a'))
        expect(settleReplayedOp(queue, sent)).toEqual([
            expect.objectContaining({ op: 'delete', id: 'a', user: 'u1' }),
        ])
    })

    it('keeps a newer edit that replaced the replayed one', () => {
        const sent = remove('srv')
        const newer = { ...remove('srv'), queued: 'later' }
        expect(settleReplayedOp([newer], sent)).toEqual([newer])
    })
})

describe('currentTickRecord', () => {
    it('reads ticks cached by the old client', () => {
        expect(
            currentTickRecord({
                id: 'a',
                date: '2026-10-01 12:00:00.000Z',
                created: '2026-10-01 10:00:00.000Z',
                updated: '2026-10-01T10:00:00.000Z',
            } as TickRecord),
        ).toMatchObject({
            date: '2026-10-01',
            created: '2026-10-01T10:00:00.000Z',
            updated: '2026-10-01T10:00:00.000Z',
        })
    })

    it('keeps current records unchanged', () => {
        const record = {
            id: 'a',
            date: '2026-10-01',
            created: '2026-10-01T10:00:00.000Z',
        } as TickRecord
        expect(currentTickRecord(record)).toEqual({
            ...record,
            updated: undefined,
        })
    })
})

describe('currentTickOp', () => {
    it('migrates a queued op of the old client', () => {
        expect(
            currentTickOp({
                op: 'create',
                id: 'a',
                queued: '2026-10-01 10:00:00.000Z',
                record: {
                    id: 'a',
                    date: '2026-10-01 12:00:00.000Z',
                    created: '2026-10-01 10:00:00.000Z',
                } as TickRecord,
            }),
        ).toMatchObject({
            queued: '2026-10-01T10:00:00.000Z',
            record: {
                date: '2026-10-01',
                created: '2026-10-01T10:00:00.000Z',
            },
        })
    })

    it('keeps a delete op without a record', () => {
        const op: TickOutboxOp = {
            op: 'delete',
            id: 'a',
            queued: '2026-10-01T10:00:00.000Z',
        }
        expect(currentTickOp(op)).toEqual({ ...op, record: undefined })
    })
})
