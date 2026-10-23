import { useTickOutbox } from '~/composables/useTickOutbox'
import type { TickRecord } from '~/types/models'
import { MAX_SERVER_ERRORS, type TickOutboxOp } from '~/utils/tickOutbox'
import { jsonResponse, mockApi } from '../api/apiMock'

type Row = { id: string }

function fakeIndexedDb() {
    const stores = new Map<string, Map<string, Row>>()
    const request = <T>(result: T) => ({ result }) as IDBRequest<T>
    const db = {
        objectStoreNames: { contains: (name: string) => stores.has(name) },
        createObjectStore: (name: string) => stores.set(name, new Map()),
        close: () => {},
        transaction(name: string) {
            const rows = stores.get(name)!
            const tx = {
                oncomplete: null as null | (() => void),
                onerror: null,
                onabort: null,
                objectStore: () => ({
                    getAll: () => request([...rows.values()]),
                    get: (id: string) => request(rows.get(id)),
                    put: (row: Row) => request(rows.set(row.id, row)),
                    delete: (id: string) => request(rows.delete(id)),
                    clear: () => request(rows.clear()),
                }),
            }
            setTimeout(() => tx.oncomplete?.(), 0)
            return tx
        },
    }
    return {
        stores,
        open() {
            const open = {
                result: db,
                onupgradeneeded: null as null | (() => void),
                onsuccess: null as null | (() => void),
            }
            setTimeout(() => {
                open.onupgradeneeded?.()
                open.onsuccess?.()
            }, 0)
            return open
        },
    }
}

const token = `x.${btoa(JSON.stringify({ exp: 4102444800 }))}.y`
const tick = (id: string, note = ''): TickRecord =>
    ({
        id,
        user: 'u1',
        route: 'r1',
        type: 'top',
        attempts: 1,
        date: '2026-10-01',
        note,
    }) as TickRecord
const created = (id: string): TickOutboxOp => ({
    op: 'create',
    id,
    user: 'u1',
    record: tick(id),
    queued: '2026-10-01T10:00:00Z',
})

let idb: ReturnType<typeof fakeIndexedDb>
let api: ReturnType<typeof mockApi>

beforeEach(() => {
    idb = fakeIndexedDb()
    vi.stubGlobal('indexedDB', idb)
    vi.stubGlobal(
        'refreshNuxtData',
        vi.fn(async () => {}),
    )
    api = mockApi()
    useAuthStore().save(token, { id: 'u1' } as never)
})

afterEach(() => {
    useAuthStore().clear()
})

async function seed(...ops: TickOutboxOp[]) {
    const outbox = useTickOutbox()
    await outbox.load()
    idb.stores.set('outbox', new Map(ops.map((op) => [op.id, op])))
    return outbox
}

function holdNextRequest() {
    let answer!: (response: Response) => void
    api.fetchMock.mockImplementationOnce(
        () => new Promise<Response>((resolve) => (answer = resolve)),
    )
    return async (response: Response) => {
        await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
        answer(response)
    }
}

const sent = () =>
    api.fetchMock.mock.calls.map((_, index) => {
        const { method, url } = api.request(index)
        return `${method} ${url}`
    })

describe('useTickOutbox', () => {
    it('asks the browser to keep storage once a tick waits offline', async () => {
        const realNavigator = navigator
        onTestFinished(() => vi.stubGlobal('navigator', realNavigator))
        const persist = vi.fn().mockResolvedValue(true)
        vi.stubGlobal('navigator', {
            ...navigator,
            onLine: false,
            storage: { persist },
        })
        api.fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

        const { queued } = await useTickOutbox().createTick({
            user: 'anna',
            route: 'r1',
        } as Omit<TickRecord, 'id'>)

        expect(queued).toBe(true)
        expect(persist).toHaveBeenCalledOnce()
    })

    it('keeps ops another tab queued when this tab writes', async () => {
        const outbox = await seed()
        idb.stores.get('outbox')!.set('other', created('other'))
        api.fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
        await outbox.deleteTick('srv')
        await vi.waitFor(() =>
            expect([...idb.stores.get('outbox')!.keys()].sort()).toEqual([
                'other',
                'srv',
            ]),
        )
    })

    it('sends ops queued by the old client in the current format', async () => {
        const outbox = await seed(
            {
                ...created('a'),
                record: {
                    ...tick('a', 'old'),
                    date: '2026-10-01 12:00:00.000Z',
                    created: '2026-10-01 10:00:00.000Z',
                },
                queued: '2026-10-01 10:00:00.000Z',
            },
            {
                op: 'update',
                id: 'b',
                user: 'u1',
                record: { ...tick('b', 'iso'), date: '2026-10-02T12:00:00Z' },
                queued: '2026-10-02T10:00:00Z',
            },
        )
        api.fetchMock.mockImplementation(async () => jsonResponse(tick('a')))
        await outbox.flush()
        expect(api.request(0).body).toEqual({
            id: 'a',
            user: 'u1',
            route: 'r1',
            type: 'top',
            attempts: 1,
            date: '2026-10-01',
            note: 'old',
        })
        expect(api.request(1).body).toEqual({
            type: 'top',
            attempts: 1,
            date: '2026-10-02',
            note: 'iso',
        })
        expect(outbox.queue.value).toEqual([])
    })

    it('replays an edit made while the queued create was being sent', async () => {
        const outbox = await seed(created('a'))
        const answer = holdNextRequest()
        const flushed = outbox.flush()
        await vi.waitFor(() => expect(sent()).toEqual(['POST /api/me/ticks']))
        await outbox.updateTick(tick('a'), { note: 'crux' })
        await answer(jsonResponse(tick('a')))
        await flushed
        expect(sent()).toEqual(['POST /api/me/ticks', 'PATCH /api/ticks/a'])
        expect(api.request().body).toMatchObject({ note: 'crux' })
        expect(outbox.queue.value).toEqual([])
    })

    it('deletes a tick removed while its queued create was being sent', async () => {
        const outbox = await seed(created('a'))
        const answer = holdNextRequest()
        const flushed = outbox.flush()
        await vi.waitFor(() => expect(sent()).toHaveLength(1))
        await outbox.deleteTick('a')
        await answer(jsonResponse(tick('a')))
        await flushed
        expect(sent()).toEqual(['POST /api/me/ticks', 'DELETE /api/ticks/a'])
        expect(outbox.queue.value).toEqual([])
    })

    it('replays an edit another tab folded into the create while it was sent', async () => {
        const outbox = await seed(created('a'))
        const answer = holdNextRequest()
        const flushed = outbox.flush()
        await vi.waitFor(() => expect(sent()).toHaveLength(1))
        idb.stores.get('outbox')!.set('a', {
            ...created('a'),
            record: tick('a', 'crux'),
        })
        await answer(jsonResponse(tick('a')))
        await flushed
        expect(sent()).toEqual(['POST /api/me/ticks', 'PATCH /api/ticks/a'])
        expect(api.request().body).toMatchObject({ note: 'crux' })
        expect(idb.stores.get('outbox')!.size).toBe(0)
    })

    it('deletes a tick another tab removed while its create was sent', async () => {
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: { request: (_name: string, run: () => unknown) => run() },
        })
        try {
            const outbox = await seed(created('a'))
            const answer = holdNextRequest()
            const flushed = outbox.flush()
            await vi.waitFor(() => expect(sent()).toHaveLength(1))
            idb.stores.get('outbox')!.delete('a')
            await answer(jsonResponse(tick('a')))
            await flushed
            expect(sent()).toEqual([
                'POST /api/me/ticks',
                'DELETE /api/ticks/a',
            ])
        } finally {
            delete (navigator as { locks?: unknown }).locks
        }
    })

    it('keeps a tick another tab settled without Web Locks', async () => {
        const outbox = await seed(created('a'))
        const answer = holdNextRequest()
        const flushed = outbox.flush()
        await vi.waitFor(() => expect(sent()).toHaveLength(1))
        idb.stores.get('outbox')!.delete('a')
        await answer(jsonResponse(tick('a')))
        await flushed
        expect(sent()).toEqual(['POST /api/me/ticks'])
        expect(outbox.queue.value).toEqual([])
    })

    it('replays each op once when flushes overlap', async () => {
        const outbox = await seed(created('a'))
        await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()])
        expect(sent()).toEqual(['POST /api/me/ticks'])
        expect(idb.stores.get('outbox')!.size).toBe(0)
    })

    const edited = (id: string, note: string): TickOutboxOp => ({
        op: 'update',
        id,
        user: 'u1',
        record: tick(id, note),
        queued: '2026-10-01T10:00:00Z',
    })
    const deleted = (id: string): TickOutboxOp => ({
        op: 'delete',
        id,
        user: 'u1',
        queued: '2026-10-01T10:00:00Z',
    })

    it.each([502, 503, 429, 401])(
        'keeps ops queued for the next flush after a %i',
        async (status) => {
            const outbox = await seed(
                created('a'),
                edited('b', 'x'),
                deleted('c'),
            )
            api.fetchMock.mockImplementation(async () =>
                jsonResponse({ message: 'try later' }, status),
            )
            await outbox.flush()
            expect(sent()).toHaveLength(1)
            expect(outbox.queue.value.map((op) => [op.id, op.failed])).toEqual([
                ['a', undefined],
                ['b', undefined],
                ['c', undefined],
            ])
        },
    )

    it('gives up on an op the server keeps failing so later ticks still sync', async () => {
        const outbox = await seed(edited('b', 'x'), deleted('c'))
        api.fetchMock.mockImplementation(async (url: string) =>
            String(url).endsWith('/api/ticks/b')
                ? jsonResponse({ message: 'boom' }, 500)
                : new Response(null, { status: 204 }),
        )

        for (let attempt = 1; attempt < MAX_SERVER_ERRORS; attempt++)
            await outbox.flush()
        expect(sent()).not.toContain('DELETE /api/ticks/c')
        expect(outbox.queue.value[0]).toMatchObject({
            id: 'b',
            serverErrors: MAX_SERVER_ERRORS - 1,
        })
        expect(outbox.queue.value[0]!.failed).toBeUndefined()

        await outbox.flush()
        expect(sent()).toContain('DELETE /api/ticks/c')
        expect(outbox.queue.value).toMatchObject([{ id: 'b', failed: 'boom' }])
    })

    it('marks an op the server rejects and replays the rest', async () => {
        const outbox = await seed(edited('b', 'x'), deleted('c'))
        api.fetchMock
            .mockResolvedValueOnce(jsonResponse({ message: 'invalid' }, 400))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
        await outbox.flush()
        expect(sent()).toEqual(['PATCH /api/ticks/b', 'DELETE /api/ticks/c'])
        expect(outbox.queue.value).toMatchObject([
            { id: 'b', failed: 'invalid' },
        ])
    })

    it('replaces a failed edit with an online edit that keeps its values', async () => {
        const outbox = await seed({ ...edited('b', 'crux'), failed: 'invalid' })
        await outbox.flush()
        api.fetchMock.mockResolvedValueOnce(
            jsonResponse({ ...tick('b', 'crux'), attempts: 3 }),
        )
        await outbox.updateTick(
            { ...tick('b', 'crux'), pending: true, syncFailed: 'invalid' },
            { attempts: 3 },
        )
        expect(api.request().body).toEqual({
            type: 'top',
            attempts: 3,
            date: '2026-10-01',
            note: 'crux',
        })
        expect(outbox.queue.value).toEqual([])
        await vi.waitFor(() => expect(idb.stores.get('outbox')!.size).toBe(0))
    })

    it('drops a queued edit once the tick is deleted online', async () => {
        const outbox = await seed(edited('b', 'x'))
        api.fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
        await outbox.flush()
        api.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await outbox.deleteTick('b')
        expect(outbox.queue.value).toEqual([])
    })
})
