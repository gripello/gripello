import { describe, expect, it, vi } from 'vitest'
import { keepWhenOffline } from '~/utils/errors'

const store = (
    value: unknown,
    { fetched = value != null, error = undefined as unknown } = {},
) => ({
    _asyncData: { key: { data: { value }, error: { value: error } } },
    payload: { data: fetched ? { key: value } : {} },
})
const offline = Object.assign(new Error('Failed to fetch'), { status: 0 })
const notFound = Object.assign(new Error('Not found'), { status: 404 })

describe('keepWhenOffline', () => {
    it('keeps the loaded data when a refresh has no network', async () => {
        await expect(
            keepWhenOffline(store({ id: 'e1' }), 'key', () =>
                Promise.reject(offline),
            ),
        ).resolves.toEqual({ id: 'e1' })
    })

    it('still fails when nothing was loaded or the server answered', async () => {
        await expect(
            keepWhenOffline(store(null), 'key', () => Promise.reject(offline)),
        ).rejects.toBe(offline)
        await expect(
            keepWhenOffline(store({ id: 'e1' }), 'key', () =>
                Promise.reject(notFound),
            ),
        ).rejects.toBe(notFound)
    })

    it('does not mistake the default or data after a failure for loaded data', async () => {
        await expect(
            keepWhenOffline(store([], { fetched: false }), 'key', () =>
                Promise.reject(offline),
            ),
        ).rejects.toBe(offline)
        await expect(
            keepWhenOffline(store([], { error: notFound }), 'key', () =>
                Promise.reject(offline),
            ),
        ).rejects.toBe(offline)
    })

    it('returns fresh data when the refresh succeeds', async () => {
        await expect(
            keepWhenOffline(store({ id: 'old' }), 'key', async () => ({
                id: 'new',
            })),
        ).resolves.toEqual({ id: 'new' })
    })

    it('drops loaded data that no longer fits the request', async () => {
        await expect(
            keepWhenOffline(
                store([{ location: 'hall-a' }]),
                'key',
                () => Promise.reject(offline),
                (rows) => rows.every((row) => row.location === 'hall-b'),
            ),
        ).rejects.toBe(offline)
    })

    it('treats a failure without a connection as offline', async () => {
        const onLine = vi
            .spyOn(navigator, 'onLine', 'get')
            .mockReturnValue(false)
        const swOffline = Object.assign(new Error('Offline'), { status: 503 })
        await expect(
            keepWhenOffline(store({ id: 'e1' }), 'key', () =>
                Promise.reject(swOffline),
            ),
        ).resolves.toEqual({ id: 'e1' })
        onLine.mockRestore()
    })

    it('does not treat server errors as offline where navigator has no onLine', async () => {
        const onLine = vi
            .spyOn(navigator, 'onLine', 'get')
            .mockReturnValue(undefined as unknown as boolean)
        await expect(
            keepWhenOffline(store({ id: 'e1' }), 'key', () =>
                Promise.reject(notFound),
            ),
        ).rejects.toBe(notFound)
        onLine.mockRestore()
    })
})
